#!/usr/bin/env python3
"""Turn the raw feature-logo exports into the set that ships in public/features.

Usage:  python3 scripts/install_feature_logos.py [SOURCE_DIR]

The originals are exported one at a time, so they arrive at different sizes,
with different amounts of empty margin, and in a few different aspect ratios.
Dropped in as-is they render at visibly different sizes on the feature cards —
a wide mark fills the card while a square one sits small in the middle of it.

So each file is: trimmed of its margins, scaled so that its bounding-box AREA
matches every other icon's (NOT its height, and not "fit the box" — equal area
is what makes a wide mark and a tall mark read as the same size to the eye),
centred on a 1120x700 canvas so the art matches the poster's 16:10 card, and
quantised to 64 colours. On flat two-colour art the quantisation is invisible
and roughly five times smaller.

Re-run this after replacing any original. Saving a new PNG straight into
public/features by hand will leave that one icon sized unlike the other twenty.
"""
import math
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SRC = os.path.expanduser("~/Apps by Me/asset for padelier")
DST = os.path.join(HERE, "public", "features")

# The exported filenames -> the slugs in src/features/discover/featureContent.ts.
MAP = {
    "Americano.png": "americano",
    "mexicano.png": "mexicano",
    "mix americano.png": "mix-americano",
    "mix mexicano.png": "mix-mexicano",
    "fixed position.png": "fixed-position",
    "fixed partner.png": "fixed-partner",
    "team sparring.png": "team-sparring",
    "scoring formats.png": "scoring-formats",
    "ranking basis.png": "ranking-basis",
    "clubs.png": "clubs",
    "league.png": "league",
    "champions.png": "champions",
    "club event.png": "club-events",
    "rating.png": "rating",
    "record.png": "record",
    "public profile.png": "public-profile",
    "join by code.png": "join-by-code",
    "watch live.png": "watch-live",
    "claim spot.png": "claim-spot",
    "offline.png": "offline",
    "hosting tools.png": "hosting-tools",
}

CANVAS_W, CANVAS_H = 1120, 700   # 16:10, the poster card's aspect
AREA_FRACTION = 0.55             # how much of the canvas one icon's box covers
CAP_W, CAP_H = 0.86, 0.88        # never let a very wide/tall mark touch the edge
MAX_UPSCALE = 2.0                # the originals are ~550px; beyond 2x goes soft
COLOURS = 64


def build(src_path: str) -> Image.Image:
    art = Image.open(src_path).convert("RGBA")
    box = art.getbbox()
    if box:
        art = art.crop(box)
    factor = math.sqrt(AREA_FRACTION * CANVAS_W * CANVAS_H / (art.width * art.height))
    factor = min(
        factor,
        CANVAS_W * CAP_W / art.width,
        CANVAS_H * CAP_H / art.height,
        MAX_UPSCALE,
    )
    art = art.resize(
        (max(1, round(art.width * factor)), max(1, round(art.height * factor))),
        Image.LANCZOS,
    )
    canvas = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    canvas.paste(art, ((CANVAS_W - art.width) // 2, (CANVAS_H - art.height) // 2), art)
    return canvas.quantize(colors=COLOURS, method=Image.FASTOCTREE)


def main() -> int:
    src_dir = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    if not os.path.isdir(src_dir):
        print(f"source folder not found: {src_dir}", file=sys.stderr)
        return 1
    os.makedirs(DST, exist_ok=True)

    missing = [name for name in MAP if not os.path.exists(os.path.join(src_dir, name))]
    before = after = 0
    for name, slug in sorted(MAP.items(), key=lambda kv: kv[1]):
        src_path = os.path.join(src_dir, name)
        if not os.path.exists(src_path):
            continue
        out_path = os.path.join(DST, slug + ".png")
        build(src_path).save(out_path, optimize=True)
        a, b = os.path.getsize(src_path), os.path.getsize(out_path)
        before += a
        after += b
        print(f"{slug:16s} {a // 1024:4d}KB -> {b // 1024:4d}KB")

    print(f"{len(MAP) - len(missing)}/{len(MAP)} written, "
          f"{before // 1024}KB -> {after // 1024}KB")
    for name in missing:
        print(f"  missing source: {name} ({MAP[name]} keeps its drawn poster)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
