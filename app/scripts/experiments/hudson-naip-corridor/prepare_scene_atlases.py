#!/usr/bin/env python3
"""Pack existing NAIP JPEG/mask blocks into lossless RGBA scene atlases.

This script never downloads or changes the corridor imagery. It stores the
already-encoded JPEG pixels unchanged in PNG RGB channels and copies the
existing route-cutline mask into alpha. Each 427x427 block gets 2px edge-
replicated padding so filtered atlas sampling does not bleed into neighbors.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

ATLAS_SIZE = 4096
CONTENT_SIZE = 427
PADDING = 2
CELL_SIZE = CONTENT_SIZE + PADDING * 2
GRID_COLUMNS = 7
GRID_ROWS = 7
BLOCKS_PER_ATLAS = GRID_COLUMNS * GRID_ROWS  # 49; 141 blocks => 49 + 49 + 43.


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def image_record(path: Path) -> dict:
    return {"path": path.name, "bytes": path.stat().st_size, "sha256": sha256(path)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True, help="corridor output/manifest.json")
    parser.add_argument("--blocks", type=Path, required=True, help="directory containing original block JPEGs and mask PNGs")
    parser.add_argument("--out", type=Path, required=True, help="directory for atlas PNGs and scene-atlases.json")
    args = parser.parse_args()
    source_manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    if source_manifest["processing"]["outputCrs"] != "EPSG:3857":
        raise ValueError("expected EPSG:3857 source blocks")
    if source_manifest["processing"]["blockPixelSize"] != CONTENT_SIZE:
        raise ValueError(f"expected {CONTENT_SIZE}px source blocks")

    records = sorted(source_manifest["outputs"]["blocks"], key=lambda row: (row["pixelOffset"][1], row["pixelOffset"][0], row["id"]))
    if len(records) != 141:
        raise ValueError(f"expected the received 141 source blocks; found {len(records)}")
    args.out.mkdir(parents=True, exist_ok=True)
    atlases = []
    placements = []
    regression_count = 0

    for atlas_index in range((len(records) + BLOCKS_PER_ATLAS - 1) // BLOCKS_PER_ATLAS):
        page_records = records[atlas_index * BLOCKS_PER_ATLAS:(atlas_index + 1) * BLOCKS_PER_ATLAS]
        canvas = np.zeros((ATLAS_SIZE, ATLAS_SIZE, 4), dtype=np.uint8)
        page_placements = []
        for local_index, block in enumerate(page_records):
            jpeg_path = args.blocks / block["rgbJpeg"]["path"]
            mask_path = args.blocks / block["alphaMaskPng"]["path"]
            if jpeg_path.stat().st_size != block["rgbJpeg"]["bytes"] or sha256(jpeg_path) != block["rgbJpeg"]["sha256"]:
                raise ValueError(f"source JPEG checksum/size mismatch: {jpeg_path}")
            if mask_path.stat().st_size != block["alphaMaskPng"]["bytes"] or sha256(mask_path) != block["alphaMaskPng"]["sha256"]:
                raise ValueError(f"source mask checksum/size mismatch: {mask_path}")

            rgb = np.asarray(Image.open(jpeg_path).convert("RGB"), dtype=np.uint8)
            alpha = np.asarray(Image.open(mask_path).convert("L"), dtype=np.uint8)
            if rgb.shape != (CONTENT_SIZE, CONTENT_SIZE, 3) or alpha.shape != (CONTENT_SIZE, CONTENT_SIZE):
                raise ValueError(f"unexpected block dimensions: {block['id']} rgb={rgb.shape}, alpha={alpha.shape}")
            rgba = np.dstack((rgb, alpha))
            padded = np.pad(rgba, ((PADDING, PADDING), (PADDING, PADDING), (0, 0)), mode="edge")

            col, row = local_index % GRID_COLUMNS, local_index // GRID_COLUMNS
            padded_x, padded_y = col * CELL_SIZE, row * CELL_SIZE
            content_x, content_y = padded_x + PADDING, padded_y + PADDING
            if padded_x + CELL_SIZE > ATLAS_SIZE or padded_y + CELL_SIZE > ATLAS_SIZE:
                raise ValueError("atlas packing exceeded its 4096px bounds")
            canvas[padded_y:padded_y + CELL_SIZE, padded_x:padded_x + CELL_SIZE] = padded

            # Regression: PNG atlas content pixels must exactly equal the decoded
            # source JPEG RGB samples and the source mask's alpha samples.
            extracted = canvas[content_y:content_y + CONTENT_SIZE, content_x:content_x + CONTENT_SIZE]
            if not np.array_equal(extracted[:, :, :3], rgb):
                raise AssertionError(f"atlas RGB regression failed: {block['id']}")
            if not np.array_equal(extracted[:, :, 3], alpha):
                raise AssertionError(f"atlas alpha regression failed: {block['id']}")
            if not np.array_equal(canvas[padded_y:padded_y + CELL_SIZE, padded_x:padded_x + CELL_SIZE], padded):
                raise AssertionError(f"edge-padding regression failed: {block['id']}")
            regression_count += 1

            ys, xs = np.nonzero(alpha)
            hist_values, hist_counts = np.unique(alpha, return_counts=True)
            valid_w, valid_h = block["validSize"]
            placement = {
                "tileId": block["id"],
                "mosaicSourceTileIds": [tile["filename"] for tile in source_manifest["selectedSourceTiles"]],
                "atlasIndex": atlas_index,
                "contentRectPxFromTopLeft": {"x": content_x, "y": content_y, "width": CONTENT_SIZE, "height": CONTENT_SIZE},
                "paddedRectPxFromTopLeft": {"x": padded_x, "y": padded_y, "width": CELL_SIZE, "height": CELL_SIZE},
                "uvRect": [content_x / ATLAS_SIZE, content_y / ATLAS_SIZE, (content_x + CONTENT_SIZE) / ATLAS_SIZE, (content_y + CONTENT_SIZE) / ATLAS_SIZE],
                "epsg": "EPSG:3857",
                "bounds3857": block["bounds3857"],
                "pixelOffsetInCorridorMosaic": block["pixelOffset"],
                "validSourceSizePx": [valid_w, valid_h],
                "decodedSourceJpeg": image_record(jpeg_path),
                "originalRouteMaskPng": image_record(mask_path),
                "maskBoundaryAndNodata": {
                    "alphaSource": "originalRouteMaskPng; copied pixel-for-pixel into atlas alpha",
                    "coveragePixelBoundsLocalPxExclusiveMax": [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1] if len(xs) else None,
                    "coveragePixelCount": int(np.count_nonzero(alpha)),
                    "nodataAlphaValue": 0,
                    "nodataPixelCount": int(np.count_nonzero(alpha == 0)),
                    "alphaValueHistogram": {str(int(value)): int(count) for value, count in zip(hist_values, hist_counts)},
                    "fullOriginalBoundaryPreservedBy": "referenced alphaMaskPng bytes and SHA-256; atlas alpha equality regression",
                },
            }
            page_placements.append(placement)
            placements.append(placement)

        atlas_path = args.out / f"scene-atlas-{atlas_index:02d}.png"
        Image.fromarray(canvas, mode="RGBA").save(atlas_path, format="PNG", optimize=True, compress_level=6)
        reopened = np.asarray(Image.open(atlas_path).convert("RGBA"), dtype=np.uint8)
        if not np.array_equal(reopened, canvas):
            raise AssertionError(f"saved atlas PNG round-trip mismatch: {atlas_path}")
        atlases.append({
            "atlasIndex": atlas_index,
            "image": image_record(atlas_path),
            "sizePx": [ATLAS_SIZE, ATLAS_SIZE],
            "format": "PNG RGBA8 lossless container of already-JPEG-encoded RGB pixels and original route-mask alpha",
            "grid": {"columns": GRID_COLUMNS, "rows": GRID_ROWS, "usedBlocks": len(page_records), "maxBlocks": BLOCKS_PER_ATLAS, "cellSizePx": CELL_SIZE, "contentSizePx": CONTENT_SIZE, "edgeReplicatedPaddingPx": PADDING},
            "placements": page_placements,
        })

    output = {
        "schemaVersion": 1,
        "dataset": source_manifest["dataset"],
        "sourceDate": source_manifest["sourceDate"],
        "licenseAndCredit": source_manifest["licenseAndCredit"],
        "route": source_manifest["corridor"],
        "worldJsonSha256": source_manifest["corridor"]["routeWorldJsonSha256"],
        "sourceTiles": source_manifest["selectedSourceTiles"],
        "processing": {
            "sourceCorridorManifestSha256": sha256(args.manifest),
            "epsg": "EPSG:3857",
            "rgbOrigin": "decoded original corridor JPEG samples; no color adjustment; no extra JPEG re-encode",
            "alphaOrigin": "original route cutline/tile-coverage mask PNG; byte-identified and copied exactly into atlas content alpha",
            "atlasPngDoesNotRecoverOriginalGeoTiffSamples": True,
            "atlasCount": len(atlases),
            "blocksPerAtlas": BLOCKS_PER_ATLAS,
            "cellPx": CELL_SIZE,
            "contentPx": CONTENT_SIZE,
            "paddingPx": PADDING,
            "paddingRule": "replicate nearest source RGBA edge pixel on all four sides; source content rect excludes padding",
            "unusedAtlasPixels": "transparent RGBA zero; contain no generated or filled image pixels",
            "regression": {"sourceBlockCount": len(records), "rgbDecodedJpegExact": True, "alphaOriginalMaskExact": True, "paddingReplicatesSourceEdgesExact": True, "atlasPngRoundTripExact": True, "checkedBlocks": regression_count},
        },
        "atlases": atlases,
        "blockCount": len(placements),
    }
    manifest_path = args.out / "scene-atlases.json"
    manifest_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Built {len(atlases)} atlases from {len(placements)} existing blocks; exact RGB/alpha/padding regression passed for {regression_count} blocks")
    print(f"Manifest: {manifest_path} ({manifest_path.stat().st_size} bytes, sha256={sha256(manifest_path)})")


if __name__ == "__main__":
    main()
