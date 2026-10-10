#!/usr/bin/env python3
"""Build an offline, source-preserving Peekskill station geometry sidecar.

Inputs are the already archived Hudson OSM/Overture sources, retained route,
and the prior 2022 NAIP Peekskill crop. No web requests are made. Geometries
stay in WGS84 and are additionally summarized in EPSG:26918; no unknown roof,
canopy, bridge, or station-house dimensions are invented.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import math
from pathlib import Path

from osgeo import gdal, ogr, osr
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
OUT = HERE / "output"
WORLD = ROOT / "app/public/geodata/hudson/world.json"
STATIONS = ROOT / "app/public/geodata/hudson/stations.json"
BUILDINGS = ROOT / "app/public/geodata/hudson/buildings.json"
SOURCES = ROOT / "app/public/geodata/hudson/sources"
NAIP = ROOT / "app/public/geodata/hudson/imagery/peekskill-naip-2022-scene.png"
NAIP_PNG = NAIP
NAIP_MANIFEST = ROOT / "app/public/geodata/hudson/imagery/scene-raster.json"
EXPECTED_WORLD = "c4a2eaea1d1ffc3d1f9c346dcceb812f10a4efb9755da146d4c18249002393ec"
STATION_ID = "node/7100409527"
PLATFORMS = {"way/533839748", "way/533839753"}
SHELTERS = {"osm/way/1307801003", "osm/way/1307801004"}
STATION_HOUSE = "osm/way/285221615"
CROSSOVER_WAYS = {"way/533839749", "way/533839750", "way/533839751", "way/1307801005"}

PHOTO_SOURCES = [
    {
        "id": "mta-renovation-canopy-art-2013",
        "url": "https://commons.wikimedia.org/wiki/File:Peekskill_E._Signage_front_(8682713117).jpg",
        "directImageUrl": "https://upload.wikimedia.org/wikipedia/commons/d/d4/Peekskill_E._Signage_front_%288682713117%29.jpg",
        "author": "Metropolitan Transportation Authority of the State of New York; photo by Ken Shung",
        "date": "2013-02-15",
        "license": "CC BY 2.0",
        "licenseUrl": "https://creativecommons.org/licenses/by/2.0/",
        "cameraWgs84": [-73.9317389, 41.2845167],
        "observations": [
            "MTA identifies this as a photo of the renovated Peekskill station and site-specific Jan Peeck's Vine artwork.",
            "Columns, canopy/eaves and attached painted-steel artwork are visible; the artwork must not be mistaken for station structure.",
            "This photo is appearance evidence, not a measured roof or canopy survey.",
        ],
        "downloaded": False,
    },
    {
        "id": "peekskill-station-house-2014",
        "url": "https://commons.wikimedia.org/wiki/File:Peekskill_railroad_station_house.jpg",
        "directImageUrl": "https://upload.wikimedia.org/wikipedia/commons/e/ee/Peekskill_railroad_station_house.jpg",
        "author": "Beyond My Ken",
        "date": "2014-10-18",
        "license": "CC BY-SA 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
        "cameraWgs84": None,
        "observations": [
            "The Commons description identifies the subject as the Peekskill Metro-North station house on Railroad Avenue.",
            "Suitable for station-house massing/roofline reference only; no scale bar or surveyed dimensions are supplied.",
        ],
        "downloaded": False,
    },
    {
        "id": "peekskill-crossover-stairs-2014",
        "url": "https://commons.wikimedia.org/wiki/File:Peekskill_railroad_station_crossover.jpg",
        "directImageUrl": "https://upload.wikimedia.org/wikipedia/commons/6/69/Peekskill_railroad_station_crossover.jpg",
        "author": "Beyond My Ken",
        "date": "2014-10-18",
        "license": "CC BY-SA 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
        "cameraWgs84": [-73.9308944, 41.2849028],
        "observations": [
            "The Commons description identifies the subject as Peekskill station crossover stairs; the photo is geolocated at the north/east-side stair approach.",
            "Confirms a stair/crossover assembly, but does not provide deck elevation, stair width, or structural material measurements.",
        ],
        "downloaded": False,
    },
]


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_gzip_json(path: Path):
    return json.load(gzip.open(path, "rt", encoding="utf-8"))


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def as_ogr(geometry_json: dict) -> ogr.Geometry:
    geom = ogr.CreateGeometryFromJson(json.dumps(geometry_json, separators=(",", ":")))
    if geom is None:
        raise ValueError("Invalid source geometry")
    return geom


def crs_transform(target_epsg=26918):
    source = osr.SpatialReference()
    source.ImportFromEPSG(4326)
    source.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    target = osr.SpatialReference()
    target.ImportFromEPSG(target_epsg)
    target.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return osr.CoordinateTransformation(source, target)


def geometry_metrics(geom_json: dict, transform) -> dict:
    g = as_ogr(geom_json)
    metric = g.Clone()
    metric.Transform(transform)
    env = metric.GetEnvelope()  # minX,maxX,minY,maxY
    geom_type = ogr.GT_Flatten(metric.GetGeometryType())
    kind = ogr.GeometryTypeToName(geom_type)
    points = []

    def collect_positions(value):
        if isinstance(value, (list, tuple)) and len(value) >= 2 and isinstance(value[0], (int, float)):
            points.append((float(value[0]), float(value[1])))
        elif isinstance(value, (list, tuple)):
            for child in value:
                collect_positions(child)

    collect_positions(geom_json["coordinates"])
    projected = []
    for lon, lat in points:
        point = ogr.Geometry(ogr.wkbPoint)
        point.AddPoint_2D(lon, lat)
        point.Transform(transform)
        projected.append((point.GetX(), point.GetY()))
    # Principal-axis extents make long diagonal platforms understandable; this
    # is a vertex-derived envelope, not a surveyed platform length/width.
    if len(projected) >= 2:
        mx = sum(p[0] for p in projected) / len(projected)
        my = sum(p[1] for p in projected) / len(projected)
        cxx = sum((x - mx) ** 2 for x, y in projected) / len(projected)
        cyy = sum((y - my) ** 2 for x, y in projected) / len(projected)
        cxy = sum((x - mx) * (y - my) for x, y in projected) / len(projected)
        angle = 0.5 * math.atan2(2 * cxy, cxx - cyy)
        axis = (math.cos(angle), math.sin(angle))
        perp = (-axis[1], axis[0])
        u = [x * axis[0] + y * axis[1] for x, y in projected]
        v = [x * perp[0] + y * perp[1] for x, y in projected]
        oriented = [max(u) - min(u), max(v) - min(v)]
    else:
        oriented = [0.0, 0.0]
    result = {
        "projectedCrs": "EPSG:26918",
        "boundsMetres": [round(env[0], 3), round(env[2], 3), round(env[1], 3), round(env[3], 3)],
        "axisAlignedWidthMetres": round(env[1] - env[0], 3),
        "axisAlignedLengthMetres": round(env[3] - env[2], 3),
        "principalAxisVertexExtentMetres": sorted(round(v, 3) for v in oriented),
        "principalAxisMethod": "PCA of original polygon/line vertices; approximate geometry envelope, not surveyed dimensions",
        "geometryType": kind,
        "vertexCount": len(points),
        "isValid": bool(metric.IsValid()),
    }
    if geom_type in (ogr.wkbPolygon, ogr.wkbMultiPolygon):
        result["areaSquareMetres"] = round(metric.GetArea(), 3)
        result["perimeterMetres"] = round(metric.Boundary().Length(), 3)
    elif geom_type in (ogr.wkbLineString, ogr.wkbMultiLineString):
        result["lengthMetres"] = round(metric.Length(), 3)
    return result


def feature(fid: str, role: str, geometry: dict, tags: dict, transform, **properties):
    return {
        "type": "Feature",
        "id": fid,
        "geometry": geometry,
        "properties": {
            "role": role,
            "sourceId": fid,
            "sourceDataset": "OpenStreetMap",
            "sourceLicense": "ODbL-1.0",
            "tags": tags,
            "geometryMetrics": geometry_metrics(geometry, transform),
            **properties,
        },
    }


def source_pixel(lon: float, lat: float, transform, geotransform) -> tuple[int, int]:
    p = ogr.Geometry(ogr.wkbPoint)
    p.AddPoint_2D(lon, lat)
    p.Transform(transform)
    # North-up raster, including non-zero crop origin.
    px = round((p.GetX() - geotransform[0]) / geotransform[1])
    py = round((p.GetY() - geotransform[3]) / geotransform[5])
    return px, py


def draw_geometry(draw, geometry, transform, geotransform, color, width=3):
    def rings(coords):
        if coords and isinstance(coords[0], (int, float)):
            yield [coords]
        elif coords and isinstance(coords[0], list) and coords[0] and isinstance(coords[0][0], (int, float)):
            yield coords
        else:
            for child in coords:
                yield from rings(child)

    if geometry["type"] == "Point":
        x, y = source_pixel(*geometry["coordinates"], transform, geotransform)
        draw.ellipse((x - 5, y - 5, x + 5, y + 5), fill=color, outline="white", width=1)
        return
    for coords in rings(geometry["coordinates"]):
        xy = [source_pixel(lon, lat, transform, geotransform) for lon, lat, *rest in coords]
        if geometry["type"] in ("Polygon", "MultiPolygon"):
            draw.line(xy + [xy[0]], fill=color, width=width, joint="curve")
        else:
            draw.line(xy, fill=color, width=width, joint="curve")


def write_naip_overlay(out_path: Path, geojson: dict) -> dict:
    raster = load_json(NAIP_MANIFEST)["sceneRaster"]
    geotransform = raster["geoTransform"]
    transform = crs_transform(3857)
    rgb = Image.open(NAIP_PNG).convert("RGB")
    draw = ImageDraw.Draw(rgb)
    colors = {
        "station": (255, 255, 255), "stop_position": (255, 0, 0),
        "active_platform_area": (255, 230, 0), "open_platform_canopy": (255, 125, 0),
        "station_house": (255, 0, 255), "pedestrian_crossover_component": (0, 230, 255),
        "station_entrance_from_stop_area": (0, 255, 80),
    }
    raster_points = []
    for f in geojson["features"]:
        role = f["properties"]["role"]
        def gather(value):
            if isinstance(value, (list, tuple)) and len(value) >= 2 and isinstance(value[0], (int, float)):
                raster_points.append(source_pixel(value[0], value[1], transform, geotransform))
            elif isinstance(value, (list, tuple)):
                for child in value:
                    gather(child)
        gather(f["geometry"]["coordinates"])
        draw_geometry(draw, f["geometry"], transform, geotransform, colors[role], 3 if "area" in role or "canopy" in role or "house" in role else 2)
        if role in ("station", "station_house", "open_platform_canopy"):
            coords = f["geometry"]["coordinates"]
            if role != "station":
                flat = []
                def flatten(value):
                    if isinstance(value, (list, tuple)) and len(value) >= 2 and isinstance(value[0], (int, float)):
                        flat.append(value)
                    elif isinstance(value, (list, tuple)):
                        for child in value:
                            flatten(child)
                flatten(coords)
                coords = [sum(c[0] for c in flat) / len(flat), sum(c[1] for c in flat) / len(flat)]
            else:
                coords = coords
            x, y = source_pixel(*coords, transform, geotransform)
            label = {"station": "Peekskill", "station_house": "Station house", "open_platform_canopy": "Open canopy"}[role]
            draw.text((x + 5, y + 4), label, fill="white", stroke_width=2, stroke_fill="black")
    rgb.save(out_path, format="PNG", optimize=False)
    inside = sum(0 <= x < rgb.width and 0 <= y < rgb.height for x, y in raster_points)
    return {"path": str(out_path.relative_to(ROOT)), "bytes": out_path.stat().st_size, "sha256": sha(out_path),
            "method": "OSM source outlines drawn over existing unmodified-color NAIP RGB crop; annotations are diagnostic only",
            "sourceVertexCoverage": {"insideCrop": inside, "totalVertices": len(raster_points), "allInside": inside == len(raster_points)}}


def main():
    gdal.UseExceptions()
    for relative, expected in load_json(HERE / "input-checksums.json").items():
        if sha(ROOT / relative) != expected:
            raise ValueError(f"Pinned source input changed: {relative}")
    world, stations, buildings = load_json(WORLD), load_json(STATIONS), load_json(BUILDINGS)
    world_sha = sha(WORLD)
    if world_sha != EXPECTED_WORLD:
        raise ValueError(f"world.json SHA mismatch: {world_sha}")
    if stations["routeWorldSha256"] != world_sha or buildings["baseWorldSha256"] != world_sha:
        raise ValueError("Station/building overlay route identity does not match world.json")
    if not NAIP.exists() or not NAIP_MANIFEST.exists():
        raise FileNotFoundError("Bundled prior NAIP crop/manifest is missing")
    if not NAIP_PNG.exists():
        raise FileNotFoundError("Bundled prior NAIP RGB PNG is missing")
    naip_manifest = load_json(NAIP_MANIFEST)
    png_entry = naip_manifest["sceneRaster"]
    if png_entry["crs"] != "EPSG:3857" or png_entry["sha256"] != "b52faa3730355e2c11ffa9599ad6a311e84fc3dac647d63151eac60b8e2355e0":
        raise ValueError("Reused runtime NAIP image projection/content changed")
    if sha(NAIP_PNG) != png_entry["sha256"] or NAIP_PNG.stat().st_size != png_entry["bytes"]:
        raise ValueError("Reused runtime NAIP PNG checksum/size mismatch")
    if Image.open(NAIP_PNG).size != tuple(png_entry["sizePixels"]):
        raise ValueError("Reused runtime NAIP image size mismatch")
    if naip_manifest["source"]["sourceSha256"] != "8c35fc499c0eec831baec91c1c03edf21f7f8dad4ca50b07076c997cb67a3bb1":
        raise ValueError("Unexpected NAIP source tile identity")

    station = next(s for s in stations["stations"] if s["id"] == STATION_ID)
    if station["name"] != "Peekskill" or station["empireServiceStopsHere"] is not False:
        raise ValueError("Peekskill station identity or service semantics changed")
    station_features = {f["id"]: f for f in stations["features"]}
    building_features = {f["id"]: f for f in buildings["features"]}
    osm_buildings = load_gzip_json(SOURCES / "osm-buildings.json.gz")
    osm_transport = load_gzip_json(SOURCES / "osm-transport.json.gz")
    osm_stations = load_gzip_json(SOURCES / "overpass-stations.json.gz")
    transport = {f"{e['type']}/{e['id']}": e for e in osm_transport["elements"]}
    raw_building = {f"{e['type']}/{e['id']}": e for e in osm_buildings["elements"]}
    raw_station = {f"{e['type']}/{e['id']}": e for e in osm_stations["elements"]}
    transform = crs_transform()
    for fid in [STATION_ID, "node/59729448", "node/3049479038", *sorted(PLATFORMS)]:
        if fid not in raw_station or raw_station[fid].get("tags", {}) != station_features[fid]["tags"]:
            raise ValueError(f"station source ID/tag mismatch: {fid}")
        raw = raw_station[fid]
        source_xy = [[raw["lon"], raw["lat"]]] if raw["type"] == "node" else [[p["lon"], p["lat"]] for p in raw["geometry"]]
        if source_xy != station_features[fid]["coordinates"]:
            raise ValueError(f"station raw-source coordinate order mismatch: {fid}")
    for fid in SHELTERS | {STATION_HOUSE}:
        osm_id = fid.removeprefix("osm/")
        raw, overlay = raw_building[osm_id], building_features[fid]
        source_xy = {(round(p["lon"], 8), round(p["lat"], 8)) for p in raw.get("geometry", [])}
        overlay_xy = {(round(p[0], 8), round(p[1], 8)) for p in overlay["coordinates"]}
        if source_xy != overlay_xy or raw.get("tags", {}) != overlay["tags"]:
            raise ValueError(f"building raw-source/overlay mismatch: {fid}")
    for fid in CROSSOVER_WAYS:
        if fid not in transport or transport[fid].get("tags", {}).get("bridge") != "yes":
            raise ValueError(f"crossover source geometry missing: {fid}")

    out_features = []
    # Canonical station marker and stop positions: location is the OSM node, not
    # a fabricated center of station land.
    for fid in [STATION_ID, "node/59729448", "node/3049479038"]:
        src = station_features[fid]
        coords = src["coordinates"][0]
        out_features.append(feature(fid, "station" if fid == STATION_ID else "stop_position", {
            "type": "Point", "coordinates": coords,
        }, src["tags"], transform, stationSMetres=station["sMetres"], stationName="Peekskill"))

    for fid in sorted(PLATFORMS):
        src = station_features[fid]
        coordinates = src["coordinates"]
        if coordinates[0] != coordinates[-1]:
            coordinates = coordinates + [coordinates[0]]
        tags = src["tags"]
        raw_height = tags.get("height")
        feet = float(raw_height[:-1]) if isinstance(raw_height, str) and raw_height.endswith("'") else None
        association = next((a for a in station["platformAssociations"] if a["id"] == fid), None)
        out_features.append(feature(fid, "active_platform_area", {
            "type": "Polygon", "coordinates": [coordinates],
        }, tags, transform,
            heightSource={"raw": raw_height, "unit": "ft" if feet is not None else "unknown", "metres": feet * 0.3048 if feet is not None else None,
                          "status": "source_tag" if feet is not None else "missing", "datum": "platform height tag; place relative to track rail top, not terrain"},
            stopAreaAssociation=association,
            activeStatus="OSM stop_area member; current MTA station record", stationName="Peekskill"))

    relation = next(r for r in stations["stopAreas"] if r["id"] == "relation/8336095")
    entrances = [m for m in relation["members"] if m["role"] == "entrance" and "lon" in m and "lat" in m]
    for member in entrances:
        fid = f"node/{member['ref']}"
        out_features.append(feature(fid, "station_entrance_from_stop_area", {
            "type": "Point", "coordinates": [member["lon"], member["lat"]],
        }, {}, transform, relationId=relation["id"], relationRole="entrance",
            tagsUnavailableInRetainedStationSubset=True))

    for fid in sorted(SHELTERS | {STATION_HOUSE}):
        src = building_features[fid]
        tags = src["tags"]
        geom = {"type": "Polygon", "coordinates": [src["coordinates"]]}
        height = src["buildingHeight"]
        role = "station_house" if fid == STATION_HOUSE else "open_platform_canopy"
        out_features.append(feature(fid, role, geom, tags, transform,
            buildingHeight={"metres": height.get("metres"), "status": height.get("status"), "method": height.get("method"),
                            "sources": height.get("sources", height.get("sourceDatasets", []))},
            gersMatches=src["provenance"].get("overtureMatches", []),
            overtureProperties=src.get("overtureProperties", {}),
            wallSemantics="open_shelter_no_solid_walls" if fid in SHELTERS else "building_walls_from_footprint; no roof shape or facade material asserted",
            sourceGeometryRecordId=src["provenance"]["geometry"]["recordId"]))

    for fid in sorted(CROSSOVER_WAYS):
        src = transport[fid]
        coords = [[p["lon"], p["lat"]] for p in src["geometry"]]
        out_features.append(feature(fid, "pedestrian_crossover_component", {
            "type": "LineString", "coordinates": coords,
        }, src.get("tags", {}), transform,
            verticalStatus="missing", widthStatus="missing", materialStatus="missing",
            assemblyId="peekskill-crossover-osm-connected-ways",
            note="bridge=yes/layer=1 segments encode topology only; no deck elevation, width or member geometry is supplied"))

    # The two open shelters have footprint-only data. Explicitly prevent the
    # downstream OSM2World default-height behavior observed in earlier tests.
    shelters = [f for f in out_features if f["properties"]["role"] == "open_platform_canopy"]
    if any(f["properties"]["buildingHeight"]["metres"] is not None for f in shelters):
        raise ValueError("Open canopy unexpectedly received an unsupported height")
    station_house = next(f for f in out_features if f["id"] == STATION_HOUSE)
    if station_house["properties"]["buildingHeight"]["status"] != "source_estimate":
        raise ValueError("Expected the retained Microsoft model-estimate station-house height")

    OUT.mkdir(parents=True, exist_ok=True)
    geojson = {"type": "FeatureCollection", "name": "Peekskill Station source geometry",
               "crs": {"type": "name", "properties": {"name": "EPSG:4326"}},
               "sourceRelations": [{"id": relation["id"], "tags": relation["tags"], "members": relation["members"]}],
               "features": out_features}
    write_json(OUT / "peekskill-station-source.geojson", geojson)
    naip_overlay = write_naip_overlay(OUT / "peekskill-naip-station-source-overlay.png", geojson)
    geometry_checks = [{"id": f["id"], "geometryValid": f["properties"]["geometryMetrics"]["isValid"]}
                       for f in out_features if f["geometry"]["type"] in ("Polygon", "MultiPolygon", "LineString")]
    if not all(x["geometryValid"] for x in geometry_checks) or not naip_overlay["sourceVertexCoverage"]["allInside"]:
        raise ValueError("Invalid source geometry or feature vertex outside the reused NAIP crop")

    source_files = [WORLD, STATIONS, BUILDINGS, SOURCES / "overpass-stations.json.gz",
                    SOURCES / "osm-buildings.json.gz", SOURCES / "osm-transport.json.gz", NAIP_PNG, NAIP_MANIFEST]
    inputs = [{"path": str(p.relative_to(ROOT)), "bytes": p.stat().st_size, "sha256": sha(p)} for p in source_files]
    platform_records = [f for f in out_features if f["properties"]["role"] == "active_platform_area"]
    canopy_records = shelters
    bridge_records = [f for f in out_features if f["properties"]["role"] == "pedestrian_crossover_component"]
    validation = {
        "experiment": "Peekskill station source-first geometry audit",
        "verifiedAt": "2026-10-10",
        "route": {"worldSha256": world_sha, "routeLengthMetres": world["route"].get("lengthMetres", stations["routeLengthMetres"]),
                  "stationId": STATION_ID, "stationSMetres": station["sMetres"], "empireServiceStopsHere": False},
        "naip": {"sourceTile": naip_manifest["source"]["tile"], "sourceSha256": naip_manifest["source"]["sourceSha256"],
                 "sourceAcquisitionDateFromTileName": naip_manifest["source"]["acquisitionDateFromTileName"],
                 "cropSha256": sha(NAIP_PNG), "cropBytes": NAIP_PNG.stat().st_size, "crs": "EPSG:3857",
                 "cropRepresentation": "existing scene raster reprojected from prior 0.6m UTM crop; no new imagery request",
                 "sceneGeoTransform": png_entry["geoTransform"],
                 "use": "overhead layout/footprint cross-check; not a building-height or facade source",
                 "diagnosticOverlay": naip_overlay},
        "counts": {"activePlatforms": len(platform_records), "openCanopies": len(canopy_records),
                   "stationHouseFootprint": 1, "crossoverComponents": len(bridge_records),
                   "stopAreaEntranceNodes": len(entrances), "georeferencedFeatures": len(out_features)},
        "geometryChecks": {"polygonAndLineFeatures": len(geometry_checks), "allValid": all(x["geometryValid"] for x in geometry_checks),
                           "rasterCoverage": naip_overlay["sourceVertexCoverage"]},
        "heightAndShapeFindings": {
            "platforms": [{"id": f["id"], "rawHeight": f["properties"]["heightSource"]["raw"],
                           "convertedMetres": f["properties"]["heightSource"]["metres"],
                           "footprintMetrics": f["properties"]["geometryMetrics"]} for f in platform_records],
            "canopies": [{"id": f["id"], "areaSquareMetres": f["properties"]["geometryMetrics"].get("areaSquareMetres"),
                          "heightStatus": f["properties"]["buildingHeight"]["status"], "walls": "open, excluded"} for f in canopy_records],
            "stationHouse": {"id": STATION_HOUSE, "heightMetres": station_house["properties"]["buildingHeight"]["metres"],
                             "heightStatus": station_house["properties"]["buildingHeight"]["status"],
                             "heightMethod": station_house["properties"]["buildingHeight"]["method"],
                             "roofShape": station_house["properties"]["tags"].get("roof:shape"),
                             "roofMaterial": station_house["properties"]["tags"].get("roof:material"),
                             "facadeMaterial": station_house["properties"]["tags"].get("building:material"),
                             "footprintMetrics": station_house["properties"]["geometryMetrics"]},
            "crossover": [{"id": f["id"], "lengthMetres": f["properties"]["geometryMetrics"].get("lengthMetres"),
                           "rawTags": f["properties"]["tags"], "heightWidthMaterial": "missing"} for f in bridge_records],
        },
        "photoSources": PHOTO_SOURCES,
        "lidar": {"status": "separate cloud point observations; not executed by this layout audit",
                  "selection": "app/scripts/experiments/peekskill-station-source/lidar-selection.json",
                  "earlierObservation": "app/scripts/experiments/peekskill-lidar/observations/report.json",
                  "coverageCaution": "2022 tile excludes east station house; 2018 tile selected for full station. Actual CRS bounds and classification must be inspected.",
                  "demCaution": "The retained USGS elevation TIFF is bare-earth terrain and is not used as a building roof/surface height."},
        "limitations": [
            "No station-house roof shape or facade material tag exists in the retained OSM geometry.",
            "The station-house height 5.555979 m is Microsoft GlobalMLBuildingFootprints model-estimated, not a measured or LiDAR height.",
            "Both canopy polygons are amenity=shelter with shelter_type=public_transport and have no height; they remain open-outline source geometry only.",
            "Crossover OSM ways map path/stairs topology, not a deck footprint, elevation, width, support layout, or materials.",
            "NAIP RGB orthophoto supports plan-view placement only; it is not facade photography and cannot yield heights.",
            "No GLB is emitted by this source-audit pass; unsupported vertical surfaces are intentionally left unmodeled.",
        ],
        "inputs": inputs,
    }
    write_json(OUT / "validation.json", validation)
    print(json.dumps({"features": len(out_features), "validation": str(OUT / "validation.json"),
                      "geojsonSha256": sha(OUT / "peekskill-station-source.geojson"),
                      "validationSha256": sha(OUT / "validation.json")}, indent=2))


if __name__ == "__main__":
    main()
