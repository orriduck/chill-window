#!/usr/bin/env python3
"""Rebuild a georeferenced RGB crop from the official NOAA-hosted 2022 NY NAIP tile.

Requires Python 3 (stdlib only), curl or urllib network access, and GDAL CLI tools
(gdalinfo, ogrinfo, gdalwarp, gdal_translate). No image enhancement is applied.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
OUT = ROOT / "output"
BBOX = (-73.934, 41.282, -73.929, 41.287)  # WGS84: west, south, east, north
INDEX_URL = "https://coastalimagery.blob.core.windows.net/digitalcoast/NY_NAIP_2022_9986/index.html"
TILE_INDEX_URL = "https://coastalimagery.blob.core.windows.net/digitalcoast/NY_NAIP_2022_9986/tileindex_NY_NAIP_2022.zip"
TILE_NAME = "m_4107341_se_18_060_20221022.tif"
TILE_URL = f"https://coastalimagery.blob.core.windows.net/digitalcoast/NY_NAIP_2022_9986/{TILE_NAME}"
EXPECTED = {
    "index.html": ("2c615abbdb5d0c98cb04a0b544b0f7ee4051f574b9dfe8835cc1342418142b05", 658365),
    "tileindex_NY_NAIP_2022.zip": ("95fb188aadd8c9729e46f0769f4f336af02db75436c88840a744d5700854c9e1", 1123506),
    TILE_NAME: ("8c35fc499c0eec831baec91c1c03edf21f7f8dad4ca50b07076c997cb67a3bb1", 446297038),
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, dest: Path) -> None:
    if dest.exists():
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "ChillWindow-NAIP-rebuild/1.0"})
    with urllib.request.urlopen(request, timeout=180) as response, dest.open("wb") as output:
        shutil.copyfileobj(response, output, length=1024 * 1024)


def run(args: list[str], capture: bool = False) -> str:
    print("+", " ".join(args), flush=True)
    result = subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE if capture else None)
    return result.stdout if capture else ""


def verify_file(path: Path, key: str) -> dict[str, object]:
    digest, size = EXPECTED[key]
    actual_digest = sha256(path)
    actual_size = path.stat().st_size
    if (actual_digest, actual_size) != (digest, size):
        raise RuntimeError(f"checksum/size mismatch for {path.name}: {actual_digest} / {actual_size}")
    return {"path": path.name, "bytes": actual_size, "sha256": actual_digest}


def main() -> None:
    for tool in ("gdalinfo", "ogrinfo", "gdalwarp", "gdal_translate"):
        if not shutil.which(tool):
            raise SystemExit(f"Missing {tool}; install GDAL CLI tools (for GitHub Actions: sudo apt-get install gdal-bin)")
    DATA.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    index = DATA / "index.html"
    tile_zip = DATA / "tileindex_NY_NAIP_2022.zip"
    tile = DATA / TILE_NAME
    for url, path in ((INDEX_URL, index), (TILE_INDEX_URL, tile_zip), (TILE_URL, tile)):
        download(url, path)
    source_files = [verify_file(index, "index.html"), verify_file(tile_zip, "tileindex_NY_NAIP_2022.zip"), verify_file(tile, TILE_NAME)]

    shape_dir = DATA / "tileindex"
    shape_dir.mkdir(exist_ok=True)
    with zipfile.ZipFile(tile_zip) as archive:
        archive.extractall(shape_dir)
    shape = shape_dir / "tileindex_NY_NAIP_2022.shp"
    west, south, east, north = BBOX
    selection = run(
        ["ogrinfo", "-ro", "-al", "-geom=NO", "-spat", str(west), str(south), str(east), str(north), str(shape)],
        capture=True,
    )
    hits = re.findall(r"^\s*filename\s*\([^)]*\)\s*=\s*([^\r\n]+)", selection, flags=re.IGNORECASE | re.MULTILINE)
    if hits != [TILE_NAME]:
        raise RuntimeError(f"Expected exactly {TILE_NAME} for bbox, got {hits!r}")

    crop_tif = OUT / "peekskill-naip-2022-rgb-26918.tif"
    png = OUT / "peekskill-naip-2022-rgb.png"
    jpg = OUT / "peekskill-naip-2022-rgb.jpg"
    run([
        "gdalwarp", "-overwrite", "-of", "GTiff", "-s_srs", "EPSG:26918", "-t_srs", "EPSG:26918",
        "-te", str(west), str(south), str(east), str(north), "-te_srs", "EPSG:4326",
        "-tr", "0.6", "0.6", "-r", "bilinear", "-b", "1", "-b", "2", "-b", "3",
        "-co", "COMPRESS=DEFLATE", "-co", "TILED=YES", "-co", "BIGTIFF=IF_SAFER", str(tile), str(crop_tif),
    ])
    run(["gdal_translate", "-q", "-of", "PNG", "-co", "WORLDFILE=YES", str(crop_tif), str(png)])
    run(["gdal_translate", "-q", "-of", "JPEG", "-co", "QUALITY=95", "-co", "WORLDFILE=YES", str(crop_tif), str(jpg)])
    gdalinfo = json.loads(run(["gdalinfo", "-json", str(crop_tif)], capture=True))
    outputs = []
    for path in (crop_tif, png, jpg, OUT / "peekskill-naip-2022-rgb.wld"):
        outputs.append({"path": path.name, "bytes": path.stat().st_size, "sha256": sha256(path)})
    manifest = {
        "title": "Peekskill, New York 2022 NAIP RGB orthophoto crop",
        "source": {
            "provider": "USDA Farm Service Agency (FSA), Aerial Photography Field Office (APFO); NOAA Digital Coast distribution",
            "collection": "New York NAIP 2022, quarter-quadrangle GeoTIFF",
            "tile": TILE_NAME,
            "tileUrl": TILE_URL,
            "sourceCrs": "EPSG:26918 (NAD83 / UTM zone 18N)",
            "acquisitionDateFromTileName": "2022-10-22",
            "pixelSizeMetres": [0.6, 0.6],
            "sourceSizePixels": [9540, 12350],
            "sourceBands": ["Red", "Green", "Blue", "Near Infrared"],
            "sourceBandInterpretationFromGdal": ["Red", "Green", "Blue", "Undefined (NOAA metadata identifies band 4 as NIR)"],
            "rgbOutputBandOrder": [1, 2, 3],
            "useConditions": "NO access limitations stated in NOAA InPort metadata; derived products should credit USDA-FSA APFO. This is not asserted as a separate license grant.",
            "noColorEnhancement": True,
            "sourceBytes": tile.stat().st_size,
            "sourceSha256": sha256(tile),
            "officialIndexUrl": INDEX_URL,
            "tileIndexUrl": TILE_INDEX_URL,
            "indexFiles": source_files,
        },
        "query": {"bboxWgs84": list(BBOX), "selection": "one tile selected by NOAA NY NAIP 2022 tile index (EPSG:4269 footprint)", "selectedTile": hits[0]},
        "processing": {
            "gdalVersion": run(["gdalinfo", "--version"], capture=True).strip(),
            "warp": "gdalwarp to EPSG:26918, 0.6m pixels, bilinear reprojection/resampling, source bands 1/2/3 only, no radiometric/color enhancement",
            "png": "lossless RGB PNG derived directly from the RGB GeoTIFF; world file supplied",
            "jpeg": "JPEG quality 95 derived directly from the RGB GeoTIFF; lossy encoding; world file supplied",
        },
        "cropRaster": {
            "crs": "EPSG:26918",
            "sizePixels": gdalinfo["size"],
            "geoTransform": gdalinfo["geoTransform"],
            "actualWgs84Extent": gdalinfo.get("wgs84Extent"),
            "bands": [{"type": b["type"], "colorInterpretation": b.get("colorInterpretation")} for b in gdalinfo["bands"]],
        },
        "outputs": outputs,
        "credits": ["USDA-FSA Aerial Photography Field Office (APFO)", "NOAA Digital Coast distributes the NY NAIP 2022 index and imagery"],
        "metadataReferences": [
            INDEX_URL,
            TILE_INDEX_URL,
            "https://www.fisheries.noaa.gov/inport/item/71609",
        ],
    }
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {ROOT / 'manifest.json'}")
    print(json.dumps(manifest, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
