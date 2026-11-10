# -*- coding: utf-8 -*-
"""Служебные преобразования моделей. Палитра и гарнитуры — в src/tokens.css.
Межстрочный не округляем, как у Медведевой: на этом сайте эталон совпал без округления (сверка /oferta на 390, плашка куки: шаг строки 16,5 px)."""
import re

PALETTE = {
    '#4b3c25': 'ink', '#4c3c26': 'ink-alt',
    '#938c83': 'muted', '#938d84': 'muted-alt',
    '#929670': 'olive', '#919670': 'olive-alt', '#8e926b': 'olive-dark',
    '#e7e9db': 'olive-soft', '#f5f4f2': 'bg', '#f5f5f5': 'neutral',
    '#ffffff': 'white', '#fff': 'white', '#373430': 'footer',
}
RADII = {'30px': 'card', '100px': 'pill', '38px': 'tag', '5px': 'xs'}
DECLARATION = re.compile(
    r"""(^|[;{])(\s*)([\w-]+)(\s*:\s*)(#[\da-f]{3,8}|\d+px|['"]?(?:Inter|Forum)['"]?)(?=\s*(?:[,;}]|!important|$))""",
    re.I,
)


def css_tokens(css):
    """Заменяем значения деклараций, сохраняя точный исходный цвет и запасное значение."""
    def replace(match):
        prefix, space, prop, separator, value = match.groups()
        key = value.strip("'\"").lower()
        token = None
        if (prop == 'color' or prop.endswith('color')) and key in PALETTE:
            token = '--c-' + PALETTE[key]
        elif prop == 'border-radius' and key in RADII:
            token = '--r-' + RADII[key]
        elif prop == 'font-family':
            token = {'inter': '--font-ui', 'forum': '--font-display'}.get(key)
        if token is None:
            return match.group()
        return f'{prefix}{space}{prop}{separator}var({token},{value})'

    return DECLARATION.sub(replace, css)

TG_RE=re.compile(r'(?:(?<=href=\\")|(?<="href":"))https?://(?:www\.)?(?:t|telegram)\.me/(\+?[A-Za-z0-9_-]{4,})/?(?:\?start=([A-Za-z0-9_-]+))?(?=\\"|")')
def tg_links(raw):
    """Ссылки Telegram в href превращаем в tg:// (DECISIONS). Видимый текст не трогаем."""
    def sub(m):
        name,start=m.group(1),m.group(2)
        if name.startswith('+'):return 'tg://join?invite='+name[1:]
        return 'tg://resolve?domain='+name+('&start='+start if start else '')
    return TG_RE.sub(sub,raw)

def round_line_heights(css,only_scenes=None):
    """Тильда (t396) округляет межстрочный до целых px: font-size × line-height → round. Повторяем это для всех правил сцен,
    включая медиа-правила, где меняется только кегль (межстрочный берётся из последнего известного для этого селектора). 14.10.2026"""
    last_lh={};last_fs={}
    def block(sel,body):
        key=sel.strip()
        if only_scenes is not None:
            m=re.search(r'#scene-(\d+)',key)
            if not m or m.group(1) not in only_scenes:return sel+'{'+body+'}'
        fs=re.search(r'font-size:\s*([\d.]+)px',body);lh=re.search(r'line-height:\s*([\d.]+)\s*(?=;|$)',body)
        if lh:last_lh[key]=float(lh.group(1))
        if fs:last_fs[key]=float(fs.group(1))
        size=last_fs.get(key);ratio=last_lh.get(key)
        if size and ratio and (fs or lh):
            px='%dpx'%int(size*ratio+0.5)
            if lh:body=body[:lh.start()]+'line-height:'+px+body[lh.end():]
            else:body=body.rstrip(';')+';line-height:'+px
        return sel+'{'+body+'}'
    def rules(text):
        return re.sub(r'([^{}@]+)\{([^{}]*)\}',lambda m:block(m.group(1),m.group(2)),text)
    return rules(css)

TG_RE=re.compile(r'(?:(?<=href=\\")|(?<="href":"))https?://(?:www\.)?(?:t|telegram)\.me/(\+?[A-Za-z0-9_-]{4,})/?(?:\?start=([A-Za-z0-9_-]+))?(?=\\"|")')
