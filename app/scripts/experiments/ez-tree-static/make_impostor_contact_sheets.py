#!/usr/bin/env python3
"""Make labeled contact sheets for inspecting the 8 rendered yaw frames.

This utility only composites previews over a neutral checkerboard; it does not
alter or replace any transparent RGBA frame used as an impostor asset.
"""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--root", type=Path, required=True, help="output directory containing frames/")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    args.out.mkdir(parents=True, exist_ok=True)
    tile = 256
    label_h = 26
    background = Image.new("RGBA", (tile, tile), (220, 222, 224, 255))
    draw_bg = ImageDraw.Draw(background)
    step = 16
    for y in range(0, tile, step):
        for x in range(0, tile, step):
            if (x // step + y // step) % 2:
                draw_bg.rectangle((x, y, x + step - 1, y + step - 1), fill=(190, 194, 198, 255))
    for tree in manifest["trees"]:
        sheet = Image.new("RGB", (tile * 4, (tile + label_h) * 2), (245, 245, 245))
        for index, frame in enumerate(tree["frames"]):
            source = Image.open(args.root / frame["file"]).convert("RGBA")
            if source.size != (512, 512):
                raise ValueError(f"unexpected frame size {source.size}: {frame['file']}")
            source.thumbnail((tile, tile), Image.Resampling.LANCZOS)
            cell = background.copy()
            cell.alpha_composite(source, ((tile - source.width) // 2, (tile - source.height) // 2))
            x = (index % 4) * tile
            y = (index // 4) * (tile + label_h)
            sheet.paste(cell.convert("RGB"), (x, y))
            ImageDraw.Draw(sheet).text((x + 8, y + tile + 4), f"{frame['yawDegrees']:03d} degrees", fill=(20, 20, 20))
        path = args.out / f"{tree['preset'].lower().replace(' ', '-')}-8-view-contact.jpg"
        sheet.save(path, format="JPEG", quality=94, subsampling=0)
        print(path)


if __name__ == "__main__":
    main()
