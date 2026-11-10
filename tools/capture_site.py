#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Снимок опубликованного сайта на Тильде вместо архива (тариф без экспорта).

Только чтение публичных URL: без форм, без входа, без запуска кода страниц.
Повторный запуск в тот же день докачивает недостающее и не создаёт дублей.

    python3 -I tools/capture_site.py [--date YYYY-MM-DD] [--force-pages]

Результат: sources/live/<дата>/{pages,assets,t123,manifest.json,inventory.json}
Код выхода 0 — всё скачано; 1 — есть ошибки (список в конце и в manifest.json);
2 — живой сайт начал отказывать, стоит подождать и запустить ещё раз.
"""
import argparse
import datetime
import hashlib
import html as htmllib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://sistemayasnosti.com"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
# Серые страницы из списка в Тильде: не опубликованы, проверяем и фиксируем 404.
EXTRA_PATHS = ["/", "/taplink", "/mini", "/about", "/clarity", "/pred", "/pred_fl",
               "/audio-club", "/audio-club-old", "/audio-club-old-old", "/header", "/footer"]
ASSET_HOSTS = re.compile(r"^(static|thb|neo)\.tildacdn\.[a-z]+$|^cdn\.jsdelivr\.net$|^cdnjs\.cloudflare\.com$|^fonts\.googleapis\.com$|^fonts\.gstatic\.com$")
URL_RE = re.compile(r"""(?:https?:)?//[a-z0-9.-]+\.[a-z]{2,}/[^\s"'`()<>\\]+""", re.I)
CSS_URL_RE = re.compile(r"""url\(\s*['"]?([^'")]+?)['"]?\s*\)""")
PAGE_DELAY, ASSET_DELAY = 1.0, 0.25
MAX_REFUSALS = 5


class Throttled(Exception):
    pass


refusals = 0


def fetch(url):
    """Возвращает (status, bytes, content_type). Сетевые ошибки — status 0."""
    global refusals
    last = (0, b"", "")
    for attempt in range(3):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                refusals = 0
                return r.status, r.read(), r.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            last = (e.code, e.read(), e.headers.get("Content-Type", ""))
            if e.code not in (403, 429, 500, 502, 503, 504):
                return last
        except Exception as e:  # таймаут, обрыв
            last = (0, str(e).encode(), "")
        time.sleep(3 * (attempt + 1))
    if last[0] in (0, 403, 429):
        refusals += 1
        if refusals >= MAX_REFUSALS:
            raise Throttled(url)
    return last


def clean_url(raw):
    u = htmllib.unescape(raw).rstrip(",;")
    if u.startswith("//"):
        u = "https:" + u
    return u.split("#")[0]


def is_asset(url):
    p = urllib.parse.urlsplit(url)
    # На jsDelivr адрес без расширения — база пути в коде или листинг папки, а не файл.
    if p.hostname == "cdn.jsdelivr.net" and not Path(p.path).suffix.strip(".").isalnum():
        return False
    if p.hostname == "cdn.jsdelivr.net" and "@main" in Path(p.path).name:
        return False
    return bool(ASSET_HOSTS.match(p.hostname or "")) and len(p.path) > 1


def find_assets(text):
    return {u for u in map(clean_url, URL_RE.findall(text)) if is_asset(u)}


def local_path(url):
    p = urllib.parse.urlsplit(url)
    parts = [re.sub(r"[^\w.@~-]", "_", s) for s in urllib.parse.unquote(p.path).split("/") if s not in ("", ".", "..")]
    rel = Path(p.hostname, *parts)
    if p.query:
        tag = hashlib.sha1(p.query.encode()).hexdigest()[:8]
        rel = rel.with_name(f"{rel.stem}__{tag}{rel.suffix or '.css'}")
    elif not rel.suffix and "fonts.googleapis" in p.hostname:
        rel = rel.with_suffix(".css")
    return rel


def slug(path):
    return "index" if path == "/" else path.strip("/").replace("/", "__")


def internal_paths(html):
    out = set()
    for href in re.findall(r'href="([^"]+)"', html):
        u = urllib.parse.urlsplit(htmllib.unescape(href))
        if u.scheme in ("http", "https") and u.hostname != "sistemayasnosti.com":
            continue
        if u.scheme not in ("", "http", "https") or not u.path.startswith("/"):
            continue
        p = u.path.rstrip("/") or "/"
        if not p.startswith("/tilda/"):
            out.add(p)
    return out


def inventory_page(path, html, out):
    meta = lambda name: (re.search(rf'<meta (?:name|property)="{name}" content="([^"]*)"', html) or [None, None])[1]
    recs = []
    t123 = out / "t123"
    # Запись начинается с id="recN"; граница — следующая запись той же страницы.
    marks = list(re.finditer(r'<div id="rec(\d+)"[^>]*?data-record-type="(\d+)"[^>]*>', html))
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(html)
        body = html[m.end():end]
        label = re.match(r"\s*<!--\s*(.*?)\s*-->", body)
        rec = {"id": m.group(1), "type": m.group(2), "label": label.group(1) if label else None}
        if m.group(2) == "396":
            rec["zeroElements"] = len(re.findall(r"data-elem-id=", body))
            rec["artboardResolutions"] = sorted(set(re.findall(r'data-artboard-height-res-(\d+)=', body)))
        if m.group(2) == "131":
            t123.mkdir(parents=True, exist_ok=True)
            name = f"{slug(path)}__rec{m.group(1)}.html"
            (t123 / name).write_text(body, encoding="utf-8")
            rec["t123File"] = f"t123/{name}"
            rec["hasScript"] = "<script" in body
        recs.append(rec)
    hrefs = sorted({htmllib.unescape(h) for h in re.findall(r'href="([^"]+)"', html)})
    outbound = [h for h in hrefs if re.match(r"(https?:|tg:|mailto:)", h)
                and not re.match(r"https?://(fonts\.|static\.tildacdn|ws\.tildacdn|neo\.tildacdn|thb\.tildacdn|tilda\.cc)", h)]
    return {
        "path": path,
        "pageId": (re.search(r'data-tilda-page-id="(\d+)"', html) or [None, None])[1],
        "projectId": (re.search(r'data-tilda-project-id="(\d+)"', html) or [None, None])[1],
        "title": htmllib.unescape((re.search(r"<title>(.*?)</title>", html, re.S) or [None, ""])[1].strip()),
        "description": meta("description"),
        "ogTitle": meta("og:title"),
        "ogDescription": meta("og:description"),
        "ogImage": meta("og:image"),
        "robots": meta("robots"),
        "canonical": (re.search(r'<link rel="canonical" href="([^"]*)"', html) or [None, None])[1],
        "records": recs,
        "popupHooks": sorted(set(re.findall(r'data-tooltip-hook="([^"]+)"', html))),
        "anchors": sorted(set(re.findall(r'href="(#[^"]+)"', html))),
        "forms": re.findall(r"<form\b[^>]*>", html),
        "videos": sorted({u for u in map(clean_url, URL_RE.findall(html)) if re.search(r"\.mp4|kinescope|youtube\.com/embed|vimeo", u)}),
        "yandexMetrika": sorted(set(re.findall(r"ym\((\d+),|mainMetrikaId='(\d+)'", html)) and
                                {a or b for a, b in re.findall(r"ym\((\d+),|mainMetrikaId='(\d+)'", html)}),
        "outboundLinks": outbound,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=datetime.date.today().isoformat())
    ap.add_argument("--force-pages", action="store_true", help="заново скачать HTML страниц")
    args = ap.parse_args()
    out = ROOT / "sources/live" / args.date
    (out / "pages").mkdir(parents=True, exist_ok=True)
    (out / "assets").mkdir(parents=True, exist_ok=True)
    mf_path = out / "manifest.json"
    mf = json.loads(mf_path.read_text()) if mf_path.exists() else {"site": SITE, "pages": {}, "assets": {}}
    errors = []

    def save():
        mf["capturedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
        mf["errors"] = errors
        mf_path.write_text(json.dumps(mf, ensure_ascii=False, indent=1), encoding="utf-8")

    code = 0
    try:
        st, data, _ = fetch(SITE + "/sitemap.xml")
        if st != 200:
            raise SystemExit(f"sitemap.xml: HTTP {st}")
        (out / "sitemap.xml").write_bytes(data)
        sitemap = [urllib.parse.urlsplit(u).path or "/" for u in re.findall(r"<loc>(.*?)</loc>", data.decode())]
        queue, seen, inventory, assets = list(dict.fromkeys(EXTRA_PATHS + sitemap)), set(), [], set()

        while queue:
            path = queue.pop(0)
            if path in seen:
                continue
            seen.add(path)
            file = out / "pages" / f"{slug(path)}.html"
            if file.exists() and not args.force_pages and mf["pages"].get(path, {}).get("status") == 200:
                body = file.read_bytes()
            else:
                time.sleep(PAGE_DELAY)
                st, body, _ = fetch(SITE + path)
                mf["pages"][path] = {"status": st, "inSitemap": path in sitemap}
                if st != 200:
                    print(f"  {st}  {path}", flush=True)
                    if path in sitemap:
                        errors.append(f"страница из sitemap {path}: HTTP {st}")
                    continue
                file.write_bytes(body)
                mf["pages"][path].update(bytes=len(body), sha256=hashlib.sha256(body).hexdigest())
                save()
            print(f"  200  {path}  {len(body)//1024} КБ", flush=True)
            html = body.decode("utf-8", "replace")
            if 'data-record-type="' not in html:
                errors.append(f"{path}: нет записей Тильды, страница получена не полностью?")
            inventory.append(inventory_page(path, html, out))
            assets |= find_assets(html)
            queue += [p for p in internal_paths(html) if p not in seen]

        (out / "inventory.json").write_text(json.dumps(inventory, ensure_ascii=False, indent=1), encoding="utf-8")

        # Адреса, которые браузер запросил сам (см. verify_snapshot.py reference).
        runtime = out / "runtime-urls.json"
        if runtime.exists():
            assets |= {u for u in json.loads(runtime.read_text()) if is_asset(u)}

        todo, done = sorted(assets), set()
        while todo:
            url = todo.pop(0)
            if url in done:
                continue
            done.add(url)
            rel = local_path(url)
            dest = out / "assets" / rel
            rec = mf["assets"].get(url)
            if rec and rec.get("status") == 200 and dest.exists():
                data = dest.read_bytes()
            else:
                time.sleep(ASSET_DELAY)
                st, data, ctype = fetch(url)
                if st != 200:
                    mf["assets"][url] = {"status": st}
                    # Плейсхолдеры thb не критичны: оригинал лежит на static.
                    (print if "thb.tildacdn" in url else errors.append)(f"ассет {url}: HTTP {st}")
                    continue
                dest.parent.mkdir(parents=True, exist_ok=True)
                tmp = dest.with_name(dest.name + ".part")
                tmp.write_bytes(data)
                tmp.replace(dest)
                mf["assets"][url] = {"status": 200, "file": rel.as_posix(), "bytes": len(data),
                                     "type": ctype, "sha256": hashlib.sha256(data).hexdigest()}
                if len(done) % 25 == 0:
                    save()
                    print(f"  ассетов: {len(done)}, в очереди {len(todo)}", flush=True)
            if rel.suffix == ".css" or "/ws/project" in url:
                text = data.decode("utf-8", "replace")
                nested = find_assets(text) if rel.suffix != ".css" else set()
                if rel.suffix == ".css":
                    nested |= {clean_url(urllib.parse.urljoin(url, u)) for u in CSS_URL_RE.findall(text) if not u.startswith("data:")}
                todo += [u for u in nested if is_asset(u) and u not in done]
    except Throttled as e:
        errors.append(f"живой сайт отказывает, остановлено на {e}; подождать 10–30 минут и запустить снова")
        code = 2
    save()

    ok_pages = sum(1 for p in mf["pages"].values() if p["status"] == 200)
    ok_assets = [a for a in mf["assets"].values() if a["status"] == 200]
    print(f"\nСтраницы: {ok_pages} из {len(mf['pages'])} (остальные — 404, не опубликованы)")
    print(f"Ассеты: {len(ok_assets)}, {sum(a['bytes'] for a in ok_assets)/1048576:.1f} МБ")
    if errors:
        print(f"\nОШИБКИ ({len(errors)}):")
        print("\n".join(" - " + e for e in errors))
        return code or 1
    print("Ошибок нет")
    return code


if __name__ == "__main__":
    sys.exit(main())
