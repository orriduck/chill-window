#!/usr/bin/env python3
"""Rebuild a real-color NOAA NAIP corridor mosaic and EPSG:3857 image blocks.

Requires GDAL/OGR Python bindings and Pillow. Source images must be the six
2022-10-22 tiles named by download-six.sh. No enhancement or synthetic pixels
are added; average resampling only downsamples the native imagery.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import subprocess
from pathlib import Path

from osgeo import gdal, ogr, osr
from PIL import Image

TILES = [
    "m_4107333_nw_18_060_20221022.tif",
    "m_4107333_se_18_060_20221022.tif",
    "m_4107333_sw_18_060_20221022.tif",
    "m_4107341_nw_18_060_20221022.tif",
    "m_4107341_se_18_060_20221022.tif",
    "m_4107341_sw_18_060_20221022.tif",
]
BASE = "https://coastalimagery.blob.core.windows.net/digitalcoast/NY_NAIP_2022_9986"
INDEX_ZIP_SHA256 = "95fb188aadd8c9729e46f0769f4f336af02db75436c88840a744d5700854c9e1"
SOURCE_DATE = "2022-10-22"
LICENSE = "USDA-FSA Aerial Photography Field Office; NOAA InPort reports no access or use constraints; attribution requested."
TILE_SIZE = 427  # 427 * 2.4m = 1024.8m nominal blocks.
RESOLUTION = 2.4


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def run(args: list[str]) -> None:
    print("+", " ".join(map(str, args)), flush=True)
    subprocess.run(args, check=True)


def make_cutline(route_json: Path, gpkg_path: Path) -> tuple[str, float]:
    data = json.loads(route_json.read_text(encoding="utf-8"))
    points = data["route"]["points"]
    if len(points) < 2:
        raise ValueError("route has fewer than two points")

    src = osr.SpatialReference()
    src.ImportFromEPSG(4326)
    utm = osr.SpatialReference()
    utm.ImportFromEPSG(26918)
    merc = osr.SpatialReference()
    merc.ImportFromEPSG(3857)
    # GeoJSON/world.json uses traditional x=longitude, y=latitude order.
    for srs in (src, utm, merc):
        srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    to_utm = osr.CoordinateTransformation(src, utm)
    to_merc = osr.CoordinateTransformation(utm, merc)
    line = ogr.Geometry(ogr.wkbLineString)
    for lon, lat in points:
        x, y, *_ = to_utm.TransformPoint(lon, lat)
        line.AddPoint_2D(x, y)
    buffer_utm = line.Buffer(1200.0, 32)
    buffer_merc = buffer_utm.Clone()
    buffer_merc.Transform(to_merc)
    if gpkg_path.exists():
        gpkg_path.unlink()
    driver = ogr.GetDriverByName("GPKG")
    ds = driver.CreateDataSource(str(gpkg_path))
    layer = ds.CreateLayer("corridor", srs=merc, geom_type=ogr.wkbPolygon)
    feat = ogr.Feature(layer.GetLayerDefn())
    feat.SetGeometry(buffer_merc)
    layer.CreateFeature(feat)
    ds = None
    return hashlib.sha256(route_json.read_bytes()).hexdigest(), buffer_utm.GetArea()


def tile_coverage_proof(route_json: Path, tile_index: Path) -> dict:
    data = json.loads(route_json.read_text(encoding="utf-8"))
    src, utm = osr.SpatialReference(), osr.SpatialReference()
    src.ImportFromEPSG(4326)
    utm.ImportFromEPSG(26918)
    src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    utm.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    to_utm = osr.CoordinateTransformation(src, utm)
    line = ogr.Geometry(ogr.wkbLineString)
    for lon, lat in data["route"]["points"]:
        x, y, *_ = to_utm.TransformPoint(lon, lat)
        line.AddPoint_2D(x, y)
    corridor = line.Buffer(1200.0, 32)
    ds = ogr.Open("/vsizip/" + str(tile_index.resolve()))
    if ds is None:
        raise RuntimeError(f"cannot read NOAA tile index: {tile_index}")
    layer = ds.GetLayer(0)
    tile_srs = layer.GetSpatialRef().Clone()
    tile_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    to_utm_tiles = osr.CoordinateTransformation(tile_srs, utm)
    candidates = []
    for feature in layer:
        geom = feature.GetGeometryRef().Clone()
        geom.Transform(to_utm_tiles)
        if geom.Intersects(corridor):
            candidates.append({"filename": feature.GetField("filename"), "url": feature.GetField("url"), "geometry": geom})
    ds = None
    all_union = None
    for item in candidates:
        clipped = corridor.Intersection(item["geometry"])
        all_union = clipped if all_union is None else all_union.Union(clipped)
    entries = []
    for item in candidates:
        other_union = None
        for other in candidates:
            if other is item:
                continue
            clipped = corridor.Intersection(other["geometry"])
            other_union = clipped if other_union is None else other_union.Union(clipped)
        unique = corridor.Intersection(item["geometry"])
        if other_union is not None:
            unique = unique.Difference(other_union)
        entries.append({"filename": item["filename"], "url": item["url"], "uniqueCoverageAreaSquareMetres": unique.GetArea()})
    mandatory = [row for row in entries if row["uniqueCoverageAreaSquareMetres"] > 0.01]
    selected_union = None
    for item in candidates:
        if item["filename"] in {row["filename"] for row in mandatory}:
            clipped = corridor.Intersection(item["geometry"])
            selected_union = clipped if selected_union is None else selected_union.Union(clipped)
    uncovered = corridor.Difference(selected_union).GetArea() if selected_union is not None else corridor.GetArea()
    if uncovered > 0.01:
        raise RuntimeError(f"mandatory unique tiles do not cover route buffer; uncovered={uncovered}")
    selected_names = {row["filename"] for row in mandatory}
    if selected_names != set(TILES):
        raise RuntimeError(f"expected six selected tiles {TILES}; index geometry produced {sorted(selected_names)}")
    return {"candidateTileCount": len(entries), "candidateTiles": entries, "minimumSelectedTileCount": len(mandatory), "selectedTiles": sorted(selected_names), "uncoveredAreaSquareMetres": uncovered, "proof": "Each selected tile has positive area not covered by any other intersecting index tile, so each is mandatory; their union covers the full buffered route. Any remaining intersecting candidate has zero unique area and is unnecessary."}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--route", type=Path, required=True, help="repo app/public/geodata/hudson/world.json")
    ap.add_argument("--sources", type=Path, required=True, help="directory containing six NOAA GeoTIFFs")
    ap.add_argument("--tile-index", type=Path, required=True, help="official tileindex_NY_NAIP_2022.zip")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    source_dir, out = args.sources.resolve(), args.out.resolve()
    work, blocks = out / "work", out / "blocks"
    work.mkdir(parents=True, exist_ok=True)
    blocks.mkdir(parents=True, exist_ok=True)
    sources = [source_dir / name for name in TILES]
    missing = [str(p) for p in sources if not p.is_file()]
    if missing:
        raise FileNotFoundError("missing source TIFF(s): " + ", ".join(missing))

    route_sha, buffer_area_m2 = make_cutline(args.route.resolve(), work / "route-buffer-1200m.gpkg")
    coverage = tile_coverage_proof(args.route.resolve(), args.tile_index.resolve())
    mosaic = work / "hudson-route-1200m-3857-2p4m.tif"
    run([
        "gdalwarp", "-overwrite", "-multi", "-wo", "NUM_THREADS=ALL_CPUS",
        "-r", "average", "-t_srs", "EPSG:3857", "-tr", str(RESOLUTION), str(RESOLUTION),
        "-tap", "-srcband", "1", "-srcband", "2", "-srcband", "3", "-dstalpha",
        "-cutline", str(work / "route-buffer-1200m.gpkg"), "-crop_to_cutline",
        "-co", "TILED=YES", "-co", "COMPRESS=DEFLATE", "-co", "BIGTIFF=IF_SAFER",
        *map(str, sources), str(mosaic),
    ])

    ds = gdal.Open(str(mosaic), gdal.GA_ReadOnly)
    if ds.RasterCount != 4:
        raise RuntimeError(f"expected RGB+alpha, got {ds.RasterCount} bands")
    gt = ds.GetGeoTransform()
    width, height = ds.RasterXSize, ds.RasterYSize
    block_records = []
    for y0 in range(0, height, TILE_SIZE):
        for x0 in range(0, width, TILE_SIZE):
            w, h = min(TILE_SIZE, width - x0), min(TILE_SIZE, height - y0)
            arrays = [ds.GetRasterBand(i).ReadAsArray(x0, y0, w, h) for i in range(1, 5)]
            alpha = arrays[3]
            if alpha is None or int(alpha.max()) == 0:
                continue
            rgb = Image.new("RGB", (TILE_SIZE, TILE_SIZE), (0, 0, 0))
            rgb_crop = Image.fromarray(__import__("numpy").dstack(arrays[:3]).astype("uint8"), "RGB")
            alpha_crop = Image.fromarray(alpha.astype("uint8"), "L")
            rgb.paste(rgb_crop, (0, 0))
            mask = Image.new("L", (TILE_SIZE, TILE_SIZE), 0)
            mask.paste(alpha_crop, (0, 0))
            stem = f"x{x0:05d}_y{y0:05d}"
            paths = {"rgbJpeg": blocks / f"{stem}.jpg", "alphaMaskPng": blocks / f"{stem}.mask.png"}
            rgb.save(paths["rgbJpeg"], quality=92, subsampling=0, optimize=True)
            mask.save(paths["alphaMaskPng"], optimize=True)
            x_min = gt[0] + x0 * gt[1]
            y_max = gt[3] + y0 * gt[5]
            record = {
                "id": stem, "pixelOffset": [x0, y0], "validSize": [w, h],
                "storedSize": [TILE_SIZE, TILE_SIZE], "epsg": 3857,
                "resolutionMetres": RESOLUTION,
                "bounds3857": [x_min, y_max + h * gt[5], x_min + w * gt[1], y_max],
                "alphaPixels": int((alpha > 0).sum()),
                "rgbJpeg": {"path": paths["rgbJpeg"].name, "bytes": paths["rgbJpeg"].stat().st_size, "sha256": sha256(paths["rgbJpeg"])},
                "alphaMaskPng": {"path": paths["alphaMaskPng"].name, "bytes": paths["alphaMaskPng"].stat().st_size, "sha256": sha256(paths["alphaMaskPng"])},
            }
            block_records.append(record)
    ds = None

    info = gdal.Info(str(mosaic), format="json")
    source_records = []
    for p in sources:
        source_records.append({"filename": p.name, "url": f"{BASE}/{p.name}", "bytes": p.stat().st_size, "sha256": sha256(p), "sourceDate": SOURCE_DATE, "sourceCrs": "EPSG:26918"})
    manifest = {
        "dataset": "NOAA/USDA-FSA NAIP New York 2022",
        "sourceDate": SOURCE_DATE, "licenseAndCredit": LICENSE,
        "indexUrl": f"{BASE}/index.html",
        "tileIndexUrl": f"{BASE}/tileindex_NY_NAIP_2022.zip",
        "tileIndexSha256": sha256(args.tile_index.resolve()),
        "noaaInPort": "https://www.fisheries.noaa.gov/inport/item/71609",
        "corridor": {"routeName": "Empire Service · Hudson Highlands · southbound", "routeWorldJsonSha256": route_sha, "bufferMetresEachSide": 1200, "bufferAreaSquareMetresUtm26918": buffer_area_m2},
        "processing": {"sourceRgbBands": [1, 2, 3], "sourceCrs": "EPSG:26918", "outputCrs": "EPSG:3857", "resampling": "average (downsample only)", "resolutionMetres": RESOLUTION, "noColorCorrectionOrSyntheticPixels": True, "blockPixelSize": TILE_SIZE, "blockNominalMetres": TILE_SIZE * RESOLUTION, "gdalVersion": gdal.VersionInfo("--version"), "mosaicGeoTransform": info["geoTransform"], "mosaicSize": info["size"]},
        "selectedSourceTiles": source_records,
        "coverageSelection": coverage,
        "outputs": {"blockCount": len(block_records), "blocks": block_records},
    }
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Created {len(block_records)} blocks at {out}; source bytes={sum(x['bytes'] for x in source_records)}")


if __name__ == "__main__":
    main()
