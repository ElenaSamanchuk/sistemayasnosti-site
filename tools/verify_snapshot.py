#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Проверка, что снимок полон: одна и та же страница с живого сайта и только из файлов.

    python3 tools/verify_snapshot.py reference [--date D]   # живой сайт: эталоны, замеры, адреса
    python3 tools/verify_snapshot.py local [--date D]       # снимок без сети: сравнение с эталоном

Один браузер без окна, страницы по очереди. Метрика и виджеты не вызываются,
формы не трогаем. Код выхода 1 — чего-то не хватает или высоты расходятся.
"""
import argparse
import datetime
import json
import mimetypes
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://sistemayasnosti.com"
BLOCK = re.compile(r"mc\.yandex|yandex\.ru/|kommo\.com|tildastat|tilda\.ws|stat\.tildacdn|tildaapi|googletagmanager|google-analytics|facebook\.")
VIEWS = {"1440": dict(viewport={"width": 1440, "height": 900}, device_scale_factor=1),
         "390": dict(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True)}
TILE = 4500  # Chromium не снимает картинку выше 16384 px, поэтому длинные страницы режем
HEIGHT_TOLERANCE = 0.01
MEASURE = """() => ({
  height: document.documentElement.scrollHeight,
  recs: [...document.querySelectorAll('.r[id^=rec]')].filter(e => e.offsetParent !== null || e.offsetHeight)
        .map(e => [e.id, e.offsetHeight]),
  brokenImages: [...document.images].filter(i => i.complete && i.currentSrc && !i.naturalWidth).map(i => i.currentSrc),
  textLength: document.body.innerText.length,
  fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight),
})"""


def slug(path):
    return "index" if path == "/" else path.strip("/").replace("/", "__")


def settle(page):
    h = page.evaluate("document.documentElement.scrollHeight")
    y, step = 0, int(page.viewport_size["height"] * 0.8)
    for _ in range(400):
        page.evaluate("y => window.scrollTo(0, y)", y)
        page.wait_for_timeout(120)
        if y >= h:
            break
        y += step
        h = page.evaluate("document.documentElement.scrollHeight")
    page.wait_for_timeout(1500)
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(600)


def shoot(page, base, height):
    width = page.viewport_size["width"]
    for i, top in enumerate(range(0, height, TILE)):
        clip = {"x": 0, "y": top, "width": width, "height": min(TILE, height - top)}
        page.screenshot(path=f"{base}-{i+1:02d}.jpg", full_page=True, clip=clip, type="jpeg", quality=82)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["reference", "local"])
    ap.add_argument("--date", default=datetime.date.today().isoformat())
    args = ap.parse_args()
    out = ROOT / "sources/live" / args.date
    mf = json.loads((out / "manifest.json").read_text())
    pages = [p for p, v in mf["pages"].items() if v["status"] == 200]
    assets = {u: out / "assets" / a["file"] for u, a in mf["assets"].items() if a["status"] == 200}
    by_tild = {}
    for u, f in assets.items():
        m = re.search(r"static\.tildacdn\.[a-z]+/(tild[^/]+)/", u)
        if m:
            by_tild[m.group(1)] = f
    ref_file = out / "reference" / "measures.json"
    ref = json.loads(ref_file.read_text()) if args.mode == "local" else {}
    result, runtime, problems = {}, set(), []
    (out / "reference").mkdir(exist_ok=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        for w, opts in VIEWS.items():
            ctx = browser.new_context(locale="ru-RU", **opts)
            for path in pages:
                missing = []

                def handle(route):
                    url = route.request.url.split("#")[0]
                    if BLOCK.search(url):
                        return route.abort()
                    if args.mode == "reference":
                        if re.search(r"tildacdn|jsdelivr|cdnjs|fonts\.g", url):
                            runtime.add(url)
                        return route.continue_()
                    p = urlsplit(url)
                    if p.hostname == "sistemayasnosti.com":
                        target = out / "pages" / f"{slug(p.path.rstrip('/') or '/')}.html"
                        if target.exists():
                            return route.fulfill(status=200, content_type="text/html; charset=utf-8", body=target.read_bytes())
                    file = assets.get(url)
                    if file is None:
                        m = re.search(r"tildacdn\.[a-z]+/(tild[^/]+)/", url)
                        file = by_tild.get(m.group(1)) if m else None
                    if file is None or not file.exists():
                        missing.append(url)
                        return route.abort()
                    ctype = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
                    return route.fulfill(status=200, content_type=ctype, body=file.read_bytes(),
                                         headers={"Access-Control-Allow-Origin": "*"})

                page = ctx.new_page()
                page.route("**/*", handle)
                page.goto(SITE + path, wait_until="load", timeout=90000)
                settle(page)
                m = page.evaluate(MEASURE)
                key = f"{path}@{w}"
                result[key] = m
                if args.mode == "reference":
                    shots = out / "reference" / slug(path)
                    shots.mkdir(exist_ok=True)
                    shoot(page, str(shots / w), m["height"])
                    time.sleep(3)  # живой сайт троттлит серии запросов
                else:
                    r = ref[key]
                    diff = abs(m["height"] - r["height"]) / max(r["height"], 1)
                    recs_live, recs_local = dict(map(tuple, r["recs"])), dict(map(tuple, m["recs"]))
                    bad = [k for k in recs_live if abs(recs_live[k] - recs_local.get(k, -999)) > 2]
                    line = f"{key:30} живой {r['height']:>6}  снимок {m['height']:>6}  блоки с разницей {len(bad)}  не хватает файлов {len(set(missing))}  битых картинок {len(m['brokenImages'])}"
                    print(line, flush=True)
                    if diff > HEIGHT_TOLERANCE or missing or m["brokenImages"]:
                        problems.append({"page": key, "heightDiff": round(diff, 4), "badRecs": bad[:20],
                                         "missing": sorted(set(missing))[:30], "brokenImages": m["brokenImages"][:20]})
                page.close()
                if args.mode == "reference":
                    print(f"эталон {key}: {m['height']} px, текст {m['textLength']}", flush=True)
            ctx.close()
        browser.close()

    if args.mode == "reference":
        ref_file.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
        (out / "runtime-urls.json").write_text(json.dumps(sorted(runtime), indent=1))
        print(f"Готово: страниц {len(pages)}, адресов браузера {len(runtime)}")
        return 0
    (out / "reference" / "local-check.json").write_text(json.dumps({"result": result, "problems": problems}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nПроверено вариантов: {len(result)}, с проблемами: {len(problems)}")
    for p in problems:
        print(json.dumps(p, ensure_ascii=False))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
