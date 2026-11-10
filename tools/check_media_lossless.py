# -*- coding: utf-8 -*-
"""Проверка без ИИ: каждый файл public/media совпадает по пикселям с исходником из снимка.

Запуск: python3 tools/check_media_lossless.py  (код 1 при любом расхождении).
Правила:
 - тот же формат: байты равны исходнику;
 - PNG -> WebP: одинаковые RGBA (включая RGB при нулевой прозрачности) и ICC-профиль;
 - MP4: полезная нагрузка mdat совпадает (допустим только перенос moov вперёд);
 - картинки Open Graph остаются побайтно теми же PNG;
 - файлы без исходника (постеры видео, созданные сборкой) только перечисляются.
"""
import hashlib
import json
import re
import sys
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from optimize_media import _mp4_boxes  # noqa: E402
from PIL import Image  # noqa: E402

SNAPSHOT = ROOT / 'sources/live/2026-11-09'
MEDIA = ROOT / 'public/media'
TOKEN = re.compile(r'tild[0-9a-f-]+/[^/?#]+')


def rgba(raw, fmt):
    with Image.open(BytesIO(raw), formats=[fmt]) as im:
        if getattr(im, 'n_frames', 1) != 1:
            return None
        icc = im.info.get('icc_profile')
        with im.convert('RGBA') as c:
            return c.size, c.tobytes(), icc


def mdat(raw):
    boxes = _mp4_boxes(raw)
    if b'mdat' not in boxes:
        return None
    a, b = boxes[b'mdat']
    return raw[a + 8:b]


def main():
    manifest = json.loads((SNAPSHOT / 'manifest.json').read_text('utf8'))
    inventory = json.loads((SNAPSHOT / 'inventory.json').read_text('utf8'))
    assets = manifest['assets']
    mapping = json.loads((ROOT / 'sources/local-media.json').read_text('utf8'))
    by_token = {}
    for url in assets:
        m = TOKEN.search(url)
        if m:
            by_token.setdefault(m.group(0).lower(), url)
    og = {assets[i['ogImage']]['sha256'] for i in inventory if i.get('ogImage') in assets}

    sources = {}
    for url, local in mapping.items():
        key = url if url in assets else by_token.get(TOKEN.search(url).group(0).lower()) if TOKEN.search(url) else None
        if key is None:
            continue
        sources.setdefault(Path(local).name, set()).add(key)

    errors, ok, generated = [], 0, []
    for path in sorted(MEDIA.iterdir()):
        name = path.name
        out = path.read_bytes()
        urls = sources.get(name)
        if not urls:
            generated.append(name)
            continue
        before = len(errors)
        for url in sorted(urls):
            a = assets[url]
            src = (SNAPSHOT / 'assets' / a['file']).read_bytes()
            if hashlib.sha256(src).hexdigest() != a['sha256']:
                errors.append('%s: исходник снимка не совпал с манифестом' % name)
                continue
            ext, sext = path.suffix, Path(a['file']).suffix.lower()
            if a['sha256'] in og and out != src:
                errors.append('%s: изображение Open Graph изменено' % name)
            elif out == src:
                pass
            elif ext == '.webp' and sext == '.png':
                x, y = rgba(src, 'PNG'), rgba(out, 'WEBP')
                if x is None or y is None or x != y:
                    errors.append('%s: пиксели или ICC отличаются от %s' % (name, a['file']))
                    continue
            elif ext == '.mp4' and sext == '.mp4':
                if mdat(out) is None or mdat(out) != mdat(src):
                    errors.append('%s: видеопоток изменён' % name)
                    continue
            else:
                errors.append('%s: неожиданное преобразование %s -> %s' % (name, sext, ext))
                continue
        if len(errors) == before:
            ok += 1
    unused = [n for n in sources if not (MEDIA / n).exists()]
    for n in unused:
        errors.append('%s: есть в local-media.json, нет в public/media' % n)
    print('Проверено файлов: %d, совпало: %d, без исходника (созданы сборкой): %d' % (len(sources) - len(unused), ok, len(generated)))
    for n in generated:
        print('  создано сборкой:', n)
    for e in errors:
        print('ОШИБКА', e)
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
