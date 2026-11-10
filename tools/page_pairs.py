# -*- coding: utf-8 -*-
"""Склеивает плитки страниц в пары «эталон | перенос»: docs/screens/pages/<slug>/pair-<ширина>-NN.jpg."""
from argparse import ArgumentParser
from pathlib import Path
from PIL import Image

OUT = Path(__file__).resolve().parents[1] / "docs/screens/pages"
SCALE = {"1440": 0.55, "390": 0.3}
GAP = 16
parser = ArgumentParser()
parser.add_argument("--output-root", type=Path, default=OUT)
parser.add_argument("slugs", nargs="*")
args = parser.parse_args()

for slug in args.slugs:
    folder = args.output_root / slug
    for width, scale in SCALE.items():
        for old in folder.glob(f"pair-{width}-*.jpg"):
            old.unlink()
        for ref in sorted(folder.glob(f"{width}-[0-9][0-9]-etalon.jpg")):
            local = folder / ref.name.replace("etalon", "perenos")
            a = Image.open(ref).convert("RGB")
            b = Image.open(local).convert("RGB") if local.exists() else Image.new("RGB", a.size, (255, 200, 200))
            pair = Image.new("RGB", (a.width + b.width + GAP, max(a.height, b.height)), (200, 60, 60))
            pair.paste(a, (0, 0))
            pair.paste(b, (a.width + GAP, 0))
            pair = pair.resize((int(pair.width * scale), int(pair.height * scale)), Image.LANCZOS)
            pair.save(folder / f"pair-{width}-{ref.name[len(width)+1:3+len(width)]}.jpg", quality=82)
    print(slug, len(list(folder.glob("pair-*.jpg"))))
