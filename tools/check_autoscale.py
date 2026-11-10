#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Автоскейл на телефонных ширинах: перенос против живого сайта (эмуляция устройства).

    python3 tools/check_autoscale.py reference [390 479]  # живой сайт: только указанные ширины (без аргументов только отсутствующие); прежние замеры сохраняются
    python3 tools/check_autoscale.py local       # собранный dist: сравнение и пары скринов

Метрика и виджеты блокируются. Код выхода 1 — высота разошлась больше чем на 1 %.
"""
import json
import re
import select
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
REF = ROOT / "sources/live/2026-11-09/autoscale"
OUT = ROOT / "docs/screens/autoscale"
PAGES = ["/", "/mini", "/clarity", "/about"]
WIDTHS = [320, 360, 390, 412, 479, 480]
HEIGHT = {320: 693, 360: 780, 390: 844, 412: 915, 479: 900, 480: 900}
BLOCK = re.compile(r"mc\.yandex|kommo\.com|tildastat|stat\.tildacdn|googletagmanager|google-analytics")


def slug(path):
    return "index" if path == "/" else path.strip("/")


def visit(ctx, url, shot, local_origin=None):
    page = ctx.new_page()
    def allow_request(route):
        request = route.request
        if local_origin:
            allowed = request.url.startswith(("data:", "blob:" + local_origin + "/")) or (
                request.method in ("GET", "HEAD") and request.url.startswith(local_origin + "/")
            )
        else:
            allowed = request.method in ("GET", "HEAD") and not BLOCK.search(request.url)
        if allowed:
            route.continue_()
        else:
            route.abort()
    page.route("**/*", allow_request)
    response = page.goto(url, wait_until="load", timeout=90000)
    if response is None or not response.ok:
        raise RuntimeError(f"{url}: HTTP {response.status if response else 'нет ответа'}")
    page.evaluate("document.fonts.ready")
    h, y = page.evaluate("document.documentElement.scrollHeight"), 0
    step = int(page.viewport_size["height"] * 0.8)
    while y < h + step:
        page.evaluate("v => window.scrollTo(0, v)", y)
        page.wait_for_timeout(120)
        y += step
        h = page.evaluate("document.documentElement.scrollHeight")
    page.wait_for_timeout(1200)
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(800)
    page.screenshot(path=str(shot), type="jpeg", quality=85)
    height, width, scroll_width = page.evaluate(
        "[document.documentElement.scrollHeight, innerWidth, document.documentElement.scrollWidth]"
    )
    page.close()
    return height, width, scroll_width


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode not in ("reference", "local"):
        raise SystemExit(__doc__)
    REF.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    server = None
    base = "https://sistemayasnosti.com"
    result, bad, comparisons = {}, [], []
    ref = json.loads((REF / "measures.json").read_text()) if (REF / "measures.json").exists() else {}
    widths = WIDTHS
    if mode == "reference":
        asked = [int(a) for a in sys.argv[2:]]
        widths = asked or [w for w in WIDTHS if any(f"{p}@{w}" not in ref for p in PAGES)]
        print("Снимаются эталоны для ширин:", widths or "нет, всё уже есть", flush=True)
    try:
        if mode == "local":
            server = subprocess.Popen(
                ["node", "--input-type=module", "-e",
                 "import { startPreview } from './tools/preview-static.mjs';"
                 "const server = await startPreview(0); console.log(server.address().port);"],
                cwd=ROOT, stdout=subprocess.PIPE, text=True,
            )
            if not select.select([server.stdout], [], [], 10)[0]:
                raise RuntimeError("Локальный сервер не запустился за 10 секунд")
            port = server.stdout.readline().strip()
            if not port.isdecimal():
                raise RuntimeError("Локальный сервер не сообщил порт")
            base = f"http://127.0.0.1:{port}"
        if mode == "local":
            widths = [w for w in WIDTHS if all(f"{p}@{w}" in ref for p in PAGES)]
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            for w in widths:
                ctx = browser.new_context(viewport={"width": w, "height": HEIGHT[w]}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="ru-RU")
                for path in PAGES:
                    key = f"{path}@{w}"
                    name = f"{slug(path)}-{w}"
                    shot = (REF if mode == "reference" else OUT) / f"{name}{'' if mode == 'reference' else '-perenos'}.jpg"
                    height, viewport_width, scroll_width = visit(
                        ctx, base + path, shot, base if mode == "local" else None
                    )
                    result[key] = height
                    if mode == "reference":
                        print(key, height, flush=True)
                        time.sleep(3)
                    else:
                        diff = abs(height - ref[key]) / ref[key]
                        overflow = scroll_width > viewport_width
                        failed = diff > 0.01 or overflow or viewport_width != w
                        comparisons.append({"path": path, "width": w, "viewportWidth": viewport_width,
                                            "scrollWidth": scroll_width, "reference": ref[key],
                                            "height": height, "deltaPercent": round(diff * 100, 3)})
                        status = "РАЗНИЦА" if failed else "ок"
                        print(f"{status}  {key:18} живой {ref[key]:>6}  перенос {height:>6}  {diff*100:.2f} %", flush=True)
                        if failed:
                            bad.append(key)
                        a, b = Image.open(REF / f"{name}.jpg"), Image.open(shot)
                        pair = Image.new("RGB", (a.width + b.width + 16, max(a.height, b.height)), (200, 60, 60))
                        pair.paste(a, (0, 0))
                        pair.paste(b, (a.width + 16, 0))
                        pair.save(OUT / f"pair-{name}.jpg", quality=85)
                ctx.close()
            browser.close()
    finally:
        if server:
            server.terminate()
            server.wait()
    if mode == "reference":
        ref.update(result)
        (REF / "measures.json").write_text(json.dumps(ref, ensure_ascii=False, indent=1))
        return 0
    if not result:
        print("Нет ни одного замера: проверка не выполнена")
        return 1
    report = {"at": datetime.now(timezone.utc).isoformat(), "tolerancePercent": 1,
              "results": comparisons, "failed": bad}
    (OUT / "measures.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(f"\nПроверено {len(result)}, расхождений {len(bad)}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
