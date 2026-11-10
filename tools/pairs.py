# -*- coding: utf-8 -*-
"""Склеивает плитки /oferta в пары «эталон | перенос» для просмотра: docs/screens/oferta/pair-<ширина>.jpg."""
from pathlib import Path
from PIL import Image
OUT=Path(__file__).resolve().parents[1]/'docs/screens/oferta'
def stitch(files):
    images=[Image.open(f).convert('RGB') for f in files]
    if not images:raise SystemExit('Нет плиток: сначала npm run shots')
    canvas=Image.new('RGB',(images[0].width,sum(i.height for i in images)),'white');y=0
    for i in images:canvas.paste(i,(0,y));y+=i.height
    return canvas
for width,scale in (('1440',0.5),('390',0.34)):
    a=stitch(sorted(OUT.glob(width+'-[0-9][0-9]-etalon.jpg')));b=stitch(sorted(OUT.glob(width+'-[0-9][0-9]-perenos.jpg')))
    gap=20;pair=Image.new('RGB',(a.width+b.width+gap,max(a.height,b.height)),(200,200,200))
    pair.paste(a,(0,0));pair.paste(b,(a.width+gap,0))
    pair=pair.resize((int(pair.width*scale),int(pair.height*scale)),Image.LANCZOS)
    pair.save(OUT/('pair-%s.jpg'%width),quality=80);print(width,a.size,b.size,'->',pair.size)
