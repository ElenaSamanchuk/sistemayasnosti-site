#!/usr/bin/env python3
"""Статический аудит переноса sistemayasnosti.com без браузера, сети и ИИ.

Запуск:  python3 tools/static_migration_audit.py        (из корня проекта или откуда угодно)
Выход:   docs/static-audit.json; код 1, если есть ошибки (error), код 0 — только предупреждения и сведения.
Проверяет снимок sources/live/2026-11-09 и собранный dist/ (сборку не запускает):
  а) Zero: left на брейкпоинте без своего значения — как наследует Тильда и что фактически даёт CSS в dist;
  б) ul/ol в текстовых атомах: сохранены и получают маркеры;
  в) 12 страниц: title, description, canonical, og:*, файл og-картинки, lang, один h1, alt, подписи кнопок и ссылок;
  г) sitemap.xml и robots.txt против tools/lib/seo.mjs (через node, только чистые функции).
"""
import glob
import json
import os
import re
import subprocess
import sys
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = os.path.join(ROOT, 'sources/live/2026-11-09')
DIST = os.path.join(ROOT, 'dist')
OUT = os.path.join(ROOT, 'docs/static-audit.json')

findings = []  # {level, check, where, what, effect}
stats = {}


def add(level, check, where, what, effect=''):
    findings.append({'level': level, 'check': check, 'where': where, 'what': what, 'effect': effect})


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


# ---------------------------------------------------------------- а) Zero: left без значения на брейкпоинте
class ZeroParser(HTMLParser):
    """Собирает артборды и элементы/группы Zero из снимка: data-field-* и data-group-*."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []  # (is_group, id) для каждого div
        self.boards = {}
        self.items = []
        self.board = None

    def handle_starttag(self, tag, attrs):
        if tag != 'div':
            return
        a = dict(attrs)
        cls = (a.get('class') or '').split()
        entry = (False, None)
        if 't396__artboard' in cls:
            self.board = a.get('data-artboard-recid')
            screens = sorted(int(x) for x in (a.get('data-artboard-screens') or '320,480,640,960,1200').split(','))
            self.boards[self.board] = screens
            entry = (False, 'board')
        elif a.get('data-elem-id') or a.get('data-group-id'):
            group = a.get('data-group-id') is not None and 'tn-group' in cls
            nid = a.get('data-group-id') if group else a.get('data-elem-id')
            prefix = 'data-group-' if group else 'data-field-'
            fields = {k[len(prefix):]: v for k, v in a.items() if k.startswith(prefix)}
            parent = next((e[1] for e in reversed(self.stack) if e[0]), None)
            self.items.append({'rec': self.board, 'id': nid, 'group': group, 'parent': parent, 'type': a.get('data-elem-type', 'group'), 'fields': fields})
            entry = (group, nid)
        self.stack.append(entry)

    def handle_endtag(self, tag):
        if tag == 'div' and self.stack:
            self.stack.pop()


def tilda_get(fields, key, screen, screens, group):
    """Копия t396_elem__getFieldValue / t396_group__getFieldValue: свой брейкпоинт, затем ближайший больший непустой."""
    top = screens[-1]
    suffix = '' if group and key in ('widthmode', 'heightmode', 'flex') else '-value'
    def attr(point):
        name = f'{key}{suffix}' if point == top else f'{key}-res-{point}{suffix}'
        return fields.get(name)
    value = attr(screen)
    if value is None:
        for point in screens:
            if point <= screen:
                continue
            value = attr(point)
            if value:
                break
    return value


def split_blocks(css):
    """Плоский разбор CSS: [(media_text|None, selector, declarations)] в порядке файла."""
    out = []
    i, n = 0, len(css)

    def body(start):
        depth, j = 1, start
        while j < n and depth:
            if css[j] == '{':
                depth += 1
            elif css[j] == '}':
                depth -= 1
            j += 1
        return css[start:j - 1], j

    while i < n:
        j = css.find('{', i)
        if j < 0:
            break
        head = css[i:j].strip()
        inner, i = body(j + 1)
        if head.startswith('@media'):
            for sel, decl in re.findall(r'([^{}]+)\{([^{}]*)\}', inner):
                out.append((head[6:].strip(), sel.strip(), decl))
        elif not head.startswith('@'):
            out.append((None, head, inner))
    return out


def media_matches(media, width):
    if media is None:
        return True
    if '(hover' in media or 'min-width:0' in media:
        return False
    mx = re.search(r'max-width:\s*(\d+)px', media)
    mn = re.search(r'min-width:\s*(\d+)px', media)
    if not mx and not mn:
        return False
    return (not mx or width <= int(mx.group(1))) and (not mn or width >= int(mn.group(1)))


def css_left_table(css_files):
    """{(rec, node): [(media, left_decl_value)]} только для правил вида #scene-REC [data-node="ID"]{...left:...}."""
    table = {}
    for path in css_files:
        if not os.path.exists(path):
            continue
        for media, sel, decl in split_blocks(read(path)):
            m = re.fullmatch(r'#scene-(\d+)\s+\[data-node="(\d+)"\]', sel)
            if not m:
                continue
            left = re.findall(r'(?:^|;)\s*left\s*:\s*([^;]+)', decl)
            if left:
                table.setdefault((m.group(1), m.group(2)), []).append((media, left[-1].strip()))
    return table


def effective_left(rules, width):
    value = None
    for media, left in rules:
        if media_matches(media, width):
            value = left
    return value


def parse_left(value):
    """'calc(50% - 480px + 30px)' -> (480, 30); '30px' -> (None, 30)."""
    if value is None:
        return None
    m = re.fullmatch(r'calc\(\s*50%\s*-\s*(-?[\d.]+)px\s*\+\s*(-?[\d.]+)px\s*\)', value)
    if m:
        return float(m.group(1)), float(m.group(2))
    m = re.fullmatch(r'calc\(\s*50%\s*-\s*(-?[\d.]+)px\s*-\s*(-?[\d.]+)px\s*\)', value)
    if m:
        return float(m.group(1)), -float(m.group(2))
    m = re.fullmatch(r'(-?[\d.]+)px', value)
    if m:
        return None, float(m.group(1))
    return 'other'


def check_zero_left():
    pages = [p for p in sorted(glob.glob(os.path.join(SNAP, 'pages/*.html')))]
    routes = json.load(open(os.path.join(ROOT, 'public/content/routes.json'), encoding='utf-8'))
    path_by_page = {os.path.basename(p)[:-5]: p for p in pages}
    route_for = {}
    for r in routes:
        name = {'/': 'index'}.get(r['path'], r['path'].lstrip('/'))
        route_for[name] = r['page']
    shared_css = [os.path.join(DIST, 'content/shared-layout.css'), os.path.join(DIST, 'content/shared-layout-layout.css')]
    total = checked = inherited = 0
    skipped = {'axisx': 0, 'units': 0, 'нет правила': 0, 'группа-родитель': 0}
    for name, html_path in path_by_page.items():
        if name in ('header', 'footer'):
            css_files = shared_css
        elif name in route_for:
            css_files = [os.path.join(DIST, f'content/{route_for[name]}.css'), os.path.join(DIST, f'content/{route_for[name]}-layout.css')] + shared_css
        else:
            continue
        parser = ZeroParser()
        parser.feed(read(html_path))
        table = css_left_table(css_files)
        by_id = {(i['rec'], i['id']): i for i in parser.items}
        for item in parser.items:
            screens = parser.boards.get(item['rec']) or [320, 480, 640, 960, 1200]
            total += 1
            for screen in screens[:-1]:  # у самого большого экрана наследовать не от кого
                own = item['fields'].get(f'left-res-{screen}-value')
                if own is not None:
                    continue
                inherited += 1
                f = item['fields']
                axisx = tilda_get(f, 'axisx', screen, screens, item['group']) or 'left'
                units = tilda_get(f, 'leftunits', screen, screens, item['group']) or 'px'
                if axisx != 'left':
                    skipped['axisx'] += 1
                    continue
                if units != 'px':
                    skipped['units'] += 1
                    continue
                rules = table.get((item['rec'], item['id']))
                if not rules:
                    skipped['нет правила'] += 1
                    continue
                want = tilda_get(f, 'left', screen, screens, item['group'])
                try:
                    want = float(want)
                except (TypeError, ValueError):
                    continue
                container = tilda_get(f, 'container', screen, screens, item['group']) or 'grid'
                parent = by_id.get((item['rec'], item['parent'])) if item['parent'] else None
                if parent is not None and tilda_get(parent['fields'], 'flex', screen, screens, True) not in (None, '', 'none'):
                    skipped['flex-родитель'] = skipped.get('flex-родитель', 0) + 1  # дети flex-группы идут в потоке, left не действует
                    continue
                if parent is not None:
                    pw = tilda_get(parent['fields'], 'left', screen, screens, True)
                    try:
                        want -= float(pw)
                    except (TypeError, ValueError):
                        pass
                checked += 1
                got = parse_left(effective_left(rules, screen))
                where = f"{name}: scene {item['rec']} узел {item['id']} ({item['type']}) на {screen}px"
                if got is None or got == 'other':
                    add('warn', 'zero-left', where, f'left в dist не разобран: {effective_left(rules, screen)}', 'проверить вручную')
                    continue
                grid_offset, left_px = got
                bad = abs(left_px - want) > 0.6
                bad_grid = container == 'grid' and parent is None and grid_offset is not None and abs(grid_offset - screen / 2) > 0.6
                if bad or bad_grid:
                    add('error', 'zero-left', where,
                        f'Тильда берёт left={want:g} от ближайшего большего экрана и считает от сетки {screen}px; в dist left={effective_left(rules, screen)}',
                        'элемент смещён относительно Тильды на этой ширине (уезжает за край или съезжает)')
    stats['zero'] = {'элементов и групп': total, 'брейкпоинтов без своего left': inherited, 'сверено': checked, 'пропущено': skipped}


# ---------------------------------------------------------------- б) ul/ol
def check_lists():
    marker_css = ''
    for p in glob.glob(os.path.join(DIST, 'assets/*.css')):
        marker_css += read(p)
    # list-style:outside без типа у минификатора = disc (тип по умолчанию); главное, что нет none
    m_ul = re.search(r'\.scene-atom ul\{([^}]*)\}', marker_css)
    has_ul = bool(m_ul) and 'list-style' in m_ul.group(1) and 'none' not in m_ul.group(1)
    has_ol = re.search(r'\.scene-atom ol\{[^}]*list-style:decimal', marker_css) is not None
    if not has_ul:
        add('error', 'lists', 'dist/assets/*.css', 'нет правила .scene-atom ul с list-style (без none)', 'маркеры списков в текстовых блоках пропадут (preflight Tailwind их снимает)')
    if not has_ol:
        add('warn', 'lists', 'dist/assets/*.css', 'нет правила .scene-atom ol с list-style:decimal', 'нумерация в текстовых блоках пропадёт, если ol появятся')
    # inline-стили, гасящие маркеры, у самих списков
    routes = json.load(open(os.path.join(ROOT, 'public/content/routes.json'), encoding='utf-8'))
    snap_total = dist_total = 0
    for r in routes:
        name = {'/': 'index'}.get(r['path'], r['path'].lstrip('/'))
        snap_html = read(os.path.join(SNAP, f'pages/{name}.html')) if os.path.exists(os.path.join(SNAP, f'pages/{name}.html')) else ''
        snap_lists = []
        for m in re.finditer(r'<(ul|ol)\b([^>]*)>', snap_html):
            if 't228' in m.group(2) or 't-menu' in m.group(2):
                continue
            end = snap_html.find(f'</{m.group(1)}>', m.end())
            snap_lists.append(snap_html[m.end():end].count('<li'))
        model = read(os.path.join(DIST, f"content/{r['page']}.json"))
        model_lists = [model[m.end():model.find(f'</{m.group(1)}>', m.end())].count('<li') for m in re.finditer(r'<(ul|ol)\b[^>]*?>', model)]
        dist_file = os.path.join(DIST, 'index.html' if r['path'] == '/' else r['path'].lstrip('/') + '/index.html')
        dhtml = read(dist_file) if os.path.exists(dist_file) else ''
        dhtml_body = re.sub(r'<script[\s\S]*?</script>', '', dhtml)
        rendered = []
        for m in re.finditer(r'<(ul|ol)\b([^>]*)>', dhtml_body):
            if 'site-nav' in m.group(2) or 'site-footer' in m.group(2):
                continue
            end = dhtml_body.find(f'</{m.group(1)}>', m.end())
            rendered.append(dhtml_body[m.end():end].count('<li'))
        snap_total += len(snap_lists)
        dist_total += len(rendered)
        if sorted(snap_lists) != sorted(model_lists):
            add('error', 'lists', f"{r['path']} (public/content/{r['page']}.json)", f'в снимке списки по пунктам {sorted(snap_lists)}, в модели {sorted(model_lists)}', 'пункты списка потеряны или добавлены')
        elif sorted(snap_lists) != sorted(x for x in rendered if x):
            add('error', 'lists', f"{r['path']} (dist)", f'в модели {sorted(model_lists)}, в собранном HTML (без меню) {sorted(rendered)}', 'списка нет в готовой странице')
        if re.search(r'<(ul|ol)\b[^>]*style="[^"]*list-style\s*:\s*none', dhtml_body):
            add('warn', 'lists', f"{r['path']} (dist)", 'у списка inline list-style:none (если это не меню)', 'маркеры скрыты')
    stats['lists'] = {'списков в снимке (без меню)': snap_total, 'списков в dist (без меню)': dist_total, 'правило ul': has_ul, 'правило ol': has_ol}


# ---------------------------------------------------------------- в) страницы dist
class HeadParser(HTMLParser):
    VOID = {'meta', 'link', 'img', 'br', 'hr', 'input', 'source', 'area', 'col', 'embed', 'param', 'track', 'wbr', 'base'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = None
        self._in_title = False
        self.metas = []
        self.links = []
        self.lang = None
        self.h1 = 0
        self.imgs = []
        self.nameless = []
        self._skip = 0
        self._cur = []  # открытые a/button: dict(tag, attrs, text, img_alt)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'html':
            self.lang = a.get('lang')
        elif tag == 'title':
            self._in_title = True
            self.title = ''
        elif tag == 'meta':
            self.metas.append(a)
        elif tag == 'link':
            self.links.append(a)
        elif tag in ('script', 'style'):
            self._skip += 1
        elif tag == 'h1':
            self.h1 += 1
        elif tag == 'img':
            self.imgs.append(a)
            if self._cur and a.get('alt'):
                self._cur[-1]['text'] += a['alt']
        elif tag in ('a', 'button'):
            self._cur.append({'tag': tag, 'attrs': a, 'text': ''})
        elif tag == 'svg' and self._cur and (a.get('aria-label') or a.get('aria-labelledby')):
            self._cur[-1]['text'] += a.get('aria-label') or 'x'

    def handle_endtag(self, tag):
        if tag == 'title':
            self._in_title = False
        elif tag in ('script', 'style') and self._skip:
            self._skip -= 1
        elif tag in ('a', 'button') and self._cur:
            cur = self._cur.pop()
            a = cur['attrs']
            if not (cur['text'].strip() or a.get('aria-label') or a.get('aria-labelledby') or a.get('title')):
                self.nameless.append((tag, a.get('href') or a.get('class') or ''))

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif not self._skip and self._cur:
            self._cur[-1]['text'] += data


def node_expectations():
    """Ожидаемые значения из tools/lib/seo.mjs: те же вызовы, что в tools/build-site.mjs. Сборка не запускается."""
    js = r"""
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const seo = await import(pathToFileURL(path.resolve('tools/lib/seo.mjs')).href);
const sales = await import(pathToFileURL(path.resolve('tools/lib/sales-pages.mjs')).href);
const routes = JSON.parse(fs.readFileSync('public/content/routes.json', 'utf8'));
const inventory = seo.loadInventory('sources/live/2026-11-09/inventory.json');
const mediaMap = JSON.parse(fs.readFileSync('sources/local-media.json', 'utf8'));
const exists = (p) => fs.existsSync(path.join('public', p));
const plan = sales.planSales(sales.loadSalesConfig('sources/sales-pages.json'), { routePaths: routes.map((r) => r.path), token: process.env.SALES_PREVIEW_TOKEN });
const salesPaths = plan.entries.map((e) => e.path);
const pages = routes.map((route) => {
  const page = JSON.parse(fs.readFileSync(`public/content/${route.page}.json`, 'utf8'));
  const entry = inventory.get(route.path);
  const f = seo.seoFields(page, entry);
  const img = seo.localOgImage(entry, page, mediaMap, exists);
  return { path: route.path, page: route.page, inInventory: !!entry, inventoryOgImage: entry?.ogImage || '', title: f.title, description: f.description, ogTitle: f.ogTitle, ogDescription: f.ogDescription, canonical: seo.canonicalUrl(route.path, entry), ogImage: img ? seo.SITE + img : null, ogImagePath: img };
});
const sm = (production) => ({ robots: seo.robotsTxt({ production }), sitemap: seo.sitemapXml(seo.publicSitemapPaths(routes, inventory, { excluded: salesPaths }), inventory) });
console.log(JSON.stringify({ pages, salesPaths, salesMode: plan.entries.map((e) => [e.path, e.mode]), preview: sm(false), production: sm(true) }));
"""
    res = subprocess.run(['node', '--input-type=module', '-e', js], cwd=ROOT, capture_output=True, text=True, timeout=60)
    if res.returncode:
        raise RuntimeError('node не разобрал tools/lib/seo.mjs: ' + res.stderr[-400:])
    return json.loads(res.stdout)


def check_pages(expect):
    robots_meta_seen = set()
    for p in expect['pages']:
        path = p['path']
        dist_file = os.path.join(DIST, 'index.html' if path == '/' else path.lstrip('/') + '/index.html')
        if not os.path.exists(dist_file):
            add('error', 'page', f'dist{path}', 'в dist нет файла страницы', 'страница не откроется')
            continue
        ps = HeadParser()
        ps.feed(read(dist_file))
        where = f'dist{"/index.html" if path == "/" else path + "/index.html"}'
        meta = {}
        for m in ps.metas:
            key = m.get('name') or m.get('property')
            if key:
                meta[key] = m.get('content')
        robots = meta.get('robots') or ''
        robots_meta_seen.add(robots)
        noindex = 'noindex' in robots
        if (ps.title or '').strip() != p['title']:
            add('error', 'seo', where, f"title «{(ps.title or '').strip()}», по снимку/модели «{p['title']}»", 'в вкладке и выдаче другой заголовок')
        if not p['title']:
            add('error', 'seo', where, 'пустой title', 'в вкладке и выдаче нет заголовка')
        if (meta.get('description') or '') != p['description']:
            add('error', 'seo', where, f"description «{meta.get('description')}», ожидалось «{p['description']}»", 'описание в выдаче и шеринге другое')
        if not p['description']:
            add('warn', 'seo', where, 'description пустой и в снимке (у Тильды он тоже не задан)', 'сниппет поисковика соберёт сам; желательно написать вручную')
        link = {l.get('rel'): l.get('href') for l in ps.links if l.get('rel') in ('canonical', 'icon')}
        if 'canonical' in link:
            if link['canonical'] != p['canonical']:
                add('error', 'seo', where, f"canonical {link['canonical']}, ожидалось {p['canonical']}", 'поисковик получит другой главный адрес')
        elif not noindex:
            add('error', 'seo', where, 'нет canonical при индексируемой сборке', 'возможны дубли страницы в поиске')
        for key, exp in (('og:title', p['ogTitle']), ('og:description', p['ogDescription'])):
            if exp and meta.get(key) != exp:
                add('error', 'seo', where, f"{key} «{meta.get(key)}», ожидалось «{exp}»", 'в превью ссылки другой текст')
            elif not exp and not meta.get(key):
                add('warn', 'seo', where, f'{key} нет и в снимке', 'превью ссылки без описания')
        og = meta.get('og:image')
        if p['ogImage'] and og != p['ogImage']:
            add('error', 'seo', where, f"og:image {og}, ожидалось {p['ogImage']}", 'в превью ссылки другая или пропавшая картинка')
        if not og:
            add('error' if p['inventoryOgImage'] else 'warn', 'seo', where, 'нет og:image' + (f" (в снимке есть {p['inventoryOgImage']}, но локальной копии нет в sources/local-media.json)" if p['inventoryOgImage'] else ' (и в снимке тоже нет)'), 'ссылка в мессенджере уйдёт без картинки')
        else:
            local = og.replace('https://sistemayasnosti.com', '')
            if not (os.path.exists(os.path.join(DIST, local.lstrip('/'))) or os.path.exists(os.path.join(ROOT, 'public', local.lstrip('/')))):
                add('error', 'seo', where, f'файла og-картинки нет: {local}', 'превью ссылки без картинки (404)')
        if meta.get('twitter:card') == 'summary_large_image' and not meta.get('twitter:image'):
            add('error', 'seo', where, 'twitter:card large, но нет twitter:image', 'карточка без картинки')
        if not ps.lang:
            add('error', 'a11y', where, 'у <html> нет lang', 'экранные читалки и переводчик определяют язык неверно')
        elif ps.lang != 'ru' and path not in ('/oferta',):
            add('info', 'a11y', where, f'html lang={ps.lang}')
        if ps.h1 != 1:
            add('error', 'seo', where, f'h1 = {ps.h1}, нужен один', 'структура заголовков и SEO')
        plain = re.sub(r'<script[\s\S]*?</script>|<style[\s\S]*?</style>|<[^>]+>', ' ', read(dist_file))
        cyr, lat = len(re.findall('[А-Яа-яЁё]', plain)), len(re.findall('[A-Za-zÀ-ÿ]', plain))
        if ps.lang == 'ru' and lat > 3 * cyr:
            add('warn', 'a11y', where, f'html lang=ru, а текст почти весь на латинице (кириллицы {cyr}, латиницы {lat}; в снимке юр-документы на испанском)', 'читалка прочтёт испанский текст русскими правилами; переводчик браузера предложит не тот язык')
        no_alt = [i for i in ps.imgs if 'alt' not in i]
        empty_alt = [i for i in ps.imgs if i.get('alt') == '']
        if no_alt:
            add('error', 'a11y', where, f'{len(no_alt)} img без атрибута alt, например {no_alt[0].get("src", "")[:80]}', 'экранная читалка зачитывает имя файла')
        if empty_alt:
            add('info', 'a11y', where, f'{len(empty_alt)} img с alt="" (декоративные; проверить, нет ли среди них смысловых)')
        if ps.nameless:
            add('error', 'a11y', where, f'{len(ps.nameless)} кнопок/ссылок без подписи: ' + ', '.join(f'{t} {h[:50]}' for t, h in ps.nameless[:5]), 'читалка произносит «ссылка» без названия; на экране может быть только значок')
    # 404 и переадресации продаж
    if os.path.exists(os.path.join(DIST, '404.html')):
        ps = HeadParser()
        ps.feed(read(os.path.join(DIST, '404.html')))
        if ps.h1 != 1:
            add('error', 'seo', 'dist/404.html', f'h1 = {ps.h1}', 'структура заголовков')
        if not ps.lang:
            add('error', 'a11y', 'dist/404.html', 'нет lang', '')
    else:
        add('error', 'page', 'dist/404.html', 'нет страницы 404', 'ошибка откроется голой заглушкой сервера')
    for sp, mode in expect['salesMode']:
        f = os.path.join(DIST, sp.lstrip('/'), 'index.html')
        if mode == 'redirect' and not os.path.exists(f):
            add('error', 'page', f'dist{sp}', 'нет файла переадресации закрытой страницы продаж', 'адрес даст 404 вместо перехода на курс')
    if len(robots_meta_seen) > 1:
        add('warn', 'seo', 'dist/*/index.html', f'разные meta robots на страницах: {sorted(robots_meta_seen)}', 'часть страниц индексируется, часть нет')
    stats['pages'] = {'страниц проверено': len(expect['pages']), 'meta robots': sorted(robots_meta_seen)}
    return robots_meta_seen


# ---------------------------------------------------------------- г) sitemap и robots
def check_sitemap_robots(expect, robots_seen):
    production = any(r.startswith('index') for r in robots_seen) and not any('noindex' in r for r in robots_seen)
    mode = 'production' if production else 'preview'
    exp = expect['production' if production else 'preview']
    for name, key in (('robots.txt', 'robots'), ('sitemap.xml', 'sitemap')):
        path = os.path.join(DIST, name)
        if not os.path.exists(path):
            add('error', 'sitemap-robots', f'dist/{name}', 'файла нет', '')
            continue
        if read(path) != exp[key]:
            add('error', 'sitemap-robots', f'dist/{name}', f'не совпадает с tools/lib/seo.mjs для режима {mode}', 'поисковик получит не те правила или адреса')
    # sitemap: каждый адрес существует в dist, закрытые продажи и служебные не попали
    sm = read(os.path.join(DIST, 'sitemap.xml')) if os.path.exists(os.path.join(DIST, 'sitemap.xml')) else ''
    locs = re.findall(r'<loc>([^<]+)</loc>', sm)
    for loc in locs:
        p = loc.replace('https://sistemayasnosti.com', '') or '/'
        f = os.path.join(DIST, 'index.html' if p == '/' else p.lstrip('/') + '/index.html')
        if not os.path.exists(f):
            add('error', 'sitemap-robots', 'dist/sitemap.xml', f'адрес {loc} есть в sitemap, а страницы в dist нет', 'поисковик получит 404')
        if p in expect['salesPaths'] or p in ('/header', '/footer'):
            add('error', 'sitemap-robots', 'dist/sitemap.xml', f'в sitemap попал {p}', 'служебный или закрытый адрес в выдаче')
    published = {p['path'] for p in expect['pages'] if p['inInventory']}
    missing = sorted(p for p in published if p not in ('/header', '/footer') and p not in expect['salesPaths'] and ('https://sistemayasnosti.com' + ('' if p == '/' else p) + ('/' if p == '/' else '')) not in locs)
    for p in missing:
        add('info', 'sitemap-robots', 'dist/sitemap.xml', f'{p} не в sitemap: по правилам seo.mjs canonical в снимке указывает на другой адрес или страница noindex', 'нормально, если так задумано; проверить решение')
    stats['sitemap'] = {'режим сборки': mode, 'адресов в sitemap': len(locs)}


def main():
    try:
        check_zero_left()
    except Exception as e:  # noqa: BLE001 - аудит не должен падать молча
        add('error', 'zero-left', 'скрипт', f'не удалось выполнить проверку: {e!r}')
    try:
        check_lists()
    except Exception as e:  # noqa: BLE001
        add('error', 'lists', 'скрипт', f'не удалось выполнить проверку: {e!r}')
    try:
        expect = node_expectations()
        seen = check_pages(expect)
        check_sitemap_robots(expect, seen)
    except Exception as e:  # noqa: BLE001
        add('error', 'seo', 'скрипт', f'не удалось выполнить проверку: {e!r}')
    counts = {lvl: sum(1 for f in findings if f['level'] == lvl) for lvl in ('error', 'warn', 'info')}
    report = {'snapshot': 'sources/live/2026-11-09', 'dist': 'dist/', 'counts': counts, 'stats': stats, 'findings': findings}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    for f in findings:
        if f['level'] != 'info':
            print(f"[{f['level']}] {f['check']} | {f['where']} | {f['what']}")
    print(json.dumps(stats, ensure_ascii=False))
    print(f"errors={counts['error']} warn={counts['warn']} info={counts['info']} -> docs/static-audit.json")
    return 1 if counts['error'] else 0


if __name__ == '__main__':
    sys.exit(main())
