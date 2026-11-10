# -*- coding: utf-8 -*-
"""Типограф из сборщика Медведевой. Меняет только видимый текст, атрибуты не трогает."""
import re
from bs4 import BeautifulSoup, NavigableString

SHORT_WORDS=r'(?:в|во|на|с|со|к|ко|о|об|обо|у|от|до|по|за|из|изо|при|про|под|над|для|без|через|и|а|но|да|или|не|ни|что|как|так|же|ли|бы|то|я|мы|вы|он|её|ее|их|его|это|все|всё)'
ABBR_END=re.compile(r'(?<![\wА-Яа-яЁё])(?:руб|коп|тыс|млн|млрд|шт|мин|сек|ч|см|мм|кг|гр|г|гг|др|пр|т\.\s?д|т\.\s?п|ул|д|стр|ед|прим|экз|вкл|макс)\.\s*$',re.I)
# В документах точки сохраняются (решение Елены); неразрывные пробелы ставятся
LEGAL_PATHS={'/oferta','/privacy','/consent','/cookie'}

INLINE_TAGS={'strong','b','em','i','u','s','span','a','font','mark','small','sup','sub'}

def ends_block(node):
    """Текст заканчивает абзац: после него нет ничего ни в самом теге, ни в строчных тегах вокруг."""
    current=node
    while True:
        if any(str(s).strip() for s in current.next_siblings):return False
        parent=current.parent
        if parent is None or parent.name not in INLINE_TAGS:return True
        current=parent

def typograf_html(html,path='',nbsp=True):
    if not html:return html
    legal=path in LEGAL_PATHS
    soup=BeautifulSoup(html,'html.parser')
    for node in list(soup.find_all(string=True)):
        if not isinstance(node,NavigableString) or node.find_parent(['svg','style','script','code','pre','textarea']):continue
        text=str(node)
        if re.search(r'https?://|www\.|[\w.+-]+@[\w.-]+',text):continue
        if nbsp:text=re.sub(r'(?<![\w-])('+SHORT_WORDS+r')[ \t]+(?=[\wА-Яа-яЁё«(„"])',lambda m:m.group(1)+'\u00a0',text,flags=re.I)
        if nbsp:text=re.sub(r'[ \t]+([—–])',lambda m:'\u00a0'+m.group(1),text)
        if nbsp:text=re.sub(r'(\d)[ \t]+(?=\d{3}(?!\d))',lambda m:m.group(1)+'\u00a0',text)
        if nbsp:text=re.sub(r'(\d)[ \t]+(?=(?:руб|₽|%|кг|г\b|см|мм|мин|сек|ч\b|дн|дней|недел|час|шт|тыс|млн))',lambda m:m.group(1)+'\u00a0',text,flags=re.I)
        if nbsp:text=re.sub(r'(№)[ \t]+(?=\d)',lambda m:m.group(1)+'\u00a0',text)
        if not legal and ends_block(node) and not ABBR_END.search(text):
            text=re.sub(r'(?<![.\d])(?<!\b[а-яa-z])\.(\s*)$',r'\1',text,flags=re.I)
        if text!=str(node):node.replace_with(text)
    return str(soup)
