# -*- coding: utf-8 -*-
"""Частотный аудит дизайна страниц-снимков Тильды (только чтение, стандартная библиотека).
Запуск: python3 -I tools/audit_design.py   Код выхода 0. Источник: sources/live/2026-11-09/pages/*.html
Считает по записям (data-elem-id): цвета текста/фона/обводок, гарнитуры, начертания, кегли, межстрочные, радиусы, отступы.
Общие блоки header/footer считаются один раз (их elem-id из страниц-дублей исключаются). Ничего из HTML не исполняется."""
import re, sys, glob, os, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = os.path.join(ROOT, 'sources', 'live', '2026-11-09', 'pages')
SHARED = ('header.html', 'footer.html')

RULE_RE = re.compile(r'data-elem-id=["\'](\d+)["\']\]([^{}]*)\{([^{}]*)\}')
ID_RE = re.compile(r"data-elem-id=['\"](\d+)['\"]")
DF_FS_RE = re.compile(r'data-field-(?:[a-z]*)fontsize(?:-res-\d+)?-value=["\']([\d.]+)["\']')
HEX_RE = re.compile(r'#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)')

def norm_color(v):
    v = v.strip().lower()
    m = re.fullmatch(r'#([0-9a-f])([0-9a-f])([0-9a-f])', v)
    if m: v = '#' + ''.join(c * 2 for c in m.groups())
    m = re.fullmatch(r'rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)', v)
    if m: v = '#%02x%02x%02x' % tuple(int(x) for x in m.groups())
    return re.sub(r'\s+', '', v)

def pick_color(val):
    """Цвет из значения, включая var(--x,#fff); transparent/inherit пропускаем."""
    out = []
    for m in HEX_RE.finditer(val):
        c = norm_color(m.group(0))
        if c not in ('rgba(0,0,0,0)',): out.append(c)
    return out

def parse_decls(body):
    d = []
    for part in body.split(';'):
        if ':' in part:
            k, v = part.split(':', 1)
            d.append((k.strip().lower(), v.strip()))
    return d

def audit_file(path, skip_ids):
    t = open(path, encoding='utf-8', errors='replace').read()
    elems = collections.defaultdict(lambda: collections.defaultdict(set))
    for m in RULE_RE.finditer(t):
        eid, sub, body = m.groups()
        if eid in skip_ids: continue
        e = elems[eid]
        for k, v in parse_decls(body):
            if k == 'color':
                for c in pick_color(v): e['text'].add(c)
            elif k in ('background-color', 'background'):
                for c in pick_color(v): e['bg'].add(c)
            elif k in ('border-color', 'border', 'outline-color'):
                for c in pick_color(v): e['border'].add(c)
            elif k == 'font-family' and 'var(' not in v:
                e['family'].add(v.split(',')[0].strip().strip('\'"'))
            elif k == 'font-weight' and re.fullmatch(r'\d+|bold|normal', v): e['weight'].add(v)
            elif k == 'font-size' and v.endswith('px'): e['size_css'].add(v[:-2])
            elif k == 'line-height' and 'var(' not in v: e['lh'].add(v)
            elif k == 'border-radius' and 'var(' not in v:
                parts = v.split()
                e['radius'].add(parts[0] if len(set(parts)) == 1 else v)
            elif k.startswith('padding'):
                parts = v.split()
                if len(set(parts)) == 1 and parts[0] in ('0', '0px'): continue
                e['padding'].add(k + ':' + v)
    # data-field-fontsize*: значения кеглей, заданные в настройках блока
    fs = collections.defaultdict(set)
    for m in re.finditer(r"<div class='t396__elem[^>]*?data-elem-id='(\d+)'([^>]*)>", t):
        eid, attrs = m.groups()
        if eid in skip_ids: continue
        for v in DF_FS_RE.findall(attrs): fs[eid].add(v)
    for eid, s in fs.items(): elems[eid]['size_df'] |= s
    # inline style="color:#..." внутри текста (частичные выделения)
    inl = collections.Counter()
    for m in re.finditer(r'style="([^"]*)"', t):
        for k, v in parse_decls(m.group(1)):
            if k == 'color':
                for c in pick_color(v): inl[c] += 1
    return elems, set(elems), inl

def main():
    files = sorted(glob.glob(os.path.join(PAGES, '*.html')))
    if not files:
        print('Нет файлов в', PAGES); return 0
    shared_ids = set()
    for n in SHARED:
        p = os.path.join(PAGES, n)
        if os.path.exists(p):
            shared_ids |= set(ID_RE.findall(open(p, encoding='utf-8', errors='replace').read()))
    cnt = {k: collections.Counter() for k in ('text', 'bg', 'border', 'family', 'weight', 'size_css', 'size_df', 'lh', 'radius', 'padding')}
    where = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
    inline = collections.Counter(); pages = []; total_elems = 0
    forum_rows = {}
    def feed(name, elems, skip_note=''):
        nonlocal total_elems
        total_elems += len(elems)
        for eid, props in elems.items():
            if 'Forum' in props.get('family', ()): forum_rows[name + ':' + eid] = props
            for k, vals in props.items():
                for v in vals:
                    cnt[k][v] += 1; where[k][v][name] += 1
    # общие блоки: один раз (header + footer), их id пропускаем на остальных страницах
    for n in SHARED:
        p = os.path.join(PAGES, n)
        if os.path.exists(p):
            el, ids, inl = audit_file(p, set()); feed('(общие)', el); inline.update(inl)
    page_files = [f for f in files if os.path.basename(f) not in SHARED]
    for f in page_files:
        el, ids, inl = audit_file(f, shared_ids)
        feed(os.path.basename(f), el); inline.update(inl); pages.append((os.path.basename(f), len(el)))
    out = {'pages': pages, 'cnt': cnt, 'where': where, 'inline': inline, 'shared': len(shared_ids), 'elems': total_elems}
    import json
    if '--json' in sys.argv:
        print(json.dumps({'cnt': {k: dict(v) for k, v in cnt.items()}, 'inline': dict(inline)}, ensure_ascii=False))
        return 0
    print('Аудит дизайна: страниц %d (без header/footer), общих записей %d, записей всего %d' % (len(page_files), len(shared_ids), total_elems))
    names = {'text': 'Цвета текста', 'bg': 'Цвета фона', 'border': 'Цвета обводок', 'family': 'Гарнитуры', 'weight': 'Начертания',
             'size_df': 'Кегли (data-field-fontsize*)', 'size_css': 'Кегли (CSS, px)', 'lh': 'Межстрочные', 'radius': 'Радиусы', 'padding': 'Отступы'}
    for k, title in names.items():
        c = cnt[k]
        print('\n== %s: %d значений ==' % (title, len(c)))
        for v, n in c.most_common(12):
            print('  %6d  %-28s %s' % (n, v, ', '.join('%s×%d' % x for x in where[k][v].most_common(3))))
    print('\nИнлайн-цвета текста (style="color:..."): %d значений' % len(inline))
    for v, n in inline.most_common(8): print('  %6d  %s' % (n, v))
    # почти-дубли цветов: расстояние по каналам RGB <= 6 (максимум по каналу)
    allc = collections.Counter()
    for k in ('text', 'bg', 'border'):
        for v, n in cnt[k].items(): allc[v] += n
    for v, n in inline.items(): allc[v] += n
    hexes = [c for c in allc if re.fullmatch(r'#[0-9a-f]{6}', c)]
    rgb = lambda h: tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
    seen = set(); print('\nПочти-дубли цветов (разница по каналу <= 6):')
    for a in sorted(hexes, key=lambda h: -allc[h]):
        if a in seen: continue
        grp = [b for b in hexes if b not in seen and max(abs(x - y) for x, y in zip(rgb(a), rgb(b))) <= 6]
        if len(grp) > 1:
            seen.update(grp)
            print('  ' + ' ~ '.join('%s (%d)' % (g, allc[g]) for g in grp) + '  -> предложение: ' + a)
    # фоны блоков (запись t-rec и артборд) и CSS-переменные T123
    blk = collections.Counter(); cvars = collections.defaultdict(set); fmen = {}
    for f in files:
        n = os.path.basename(f); t = open(f, encoding='utf-8', errors='replace').read()
        if n not in SHARED or True:
            for m in re.finditer(r'class="r t-rec[^"]*" style="([^"]*)"|\.t396__artboard\{([^}]*)\}', t):
                for k, v in parse_decls(m.group(1) or m.group(2) or ''):
                    if k == 'background-color':
                        for c in pick_color(v): blk[(n if n in SHARED else 'страницы', c)] += 1
        for m in re.finditer(r'(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\b', t): cvars[n].add((m.group(1), norm_color(m.group(2))))
        fmen[n] = len(re.findall(r'Forum', t))
    print('\nФоны блоков (запись/артборд), header и footer отдельно:')
    for (n, c), k in sorted(blk.items(), key=lambda x: -x[1])[:12]: print('  %5d  %-10s %s' % (k, c, n))
    print('\nCSS-переменные с цветом в файлах (переменных): ' + ', '.join('%s=%d' % (n, len(v)) for n, v in sorted(cvars.items()) if v))
    for n, v in sorted(cvars.items()):
        if n.startswith('audio-club.'): print('  audio-club.html: ' + ' '.join('%s=%s' % x for x in sorted(v)))
    print('Упоминаний Forum в файлах: ' + ', '.join('%s×%d' % x for x in fmen.items() if x[1]))
    print('\nForum, по записям (кегль/межстрочный/регистр):')
    for eid, props in sorted(forum_rows.items()):
        print('  %s %s  %s' % (eid, ' '.join(sorted(props.get('size_css', []))), ' '.join(sorted(props.get('lh', [])))))
    print('\nForum (CSS-записей): ' + ', '.join('%s×%d' % (n, where['family']['Forum'][n]) for n in where['family']['Forum']))
    return 0

if __name__ == '__main__':
    sys.exit(main())
