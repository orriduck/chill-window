#!/usr/bin/env python3
"""Fetch and prepare source-backed Hudson scenery; never generates elevations.

Dependencies: Python 3.11+, Pillow, shapely. For example:
  python3 -m venv --system-site-packages /tmp/chill-hudson-venv
  /tmp/chill-hudson-venv/bin/pip install Pillow shapely
  /tmp/chill-hudson-venv/bin/python app/scripts/prepare-hudson.py

Cached source snapshots are retained for reproducibility. Pass --refresh to fetch
new source data; source changes can change the derived bundle.
"""

import argparse
import array
import collections
import datetime
import gzip
import hashlib
import io
import json
import math
import os
from pathlib import Path
import shutil
import sys
import tempfile
import urllib.parse
import urllib.request

from PIL import Image
import PIL
import shapely
from shapely import make_valid, set_precision
from shapely.geometry import LineString, Polygon, box
from shapely.ops import polygonize, transform

ROOT = Path(__file__).resolve().parents[1] / "public/geodata/hudson"
BBOX = [-74.08, 41.25, -73.85, 41.46]
ORIGIN = [-73.96, 41.36]
R = 6378137.0
K = math.cos(math.radians(ORIGIN[1]))
X0 = R * math.radians(ORIGIN[0])
Y0 = R * math.log(math.tan(math.pi / 4 + math.radians(ORIGIN[1]) / 2))
DATE = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
USGS = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer"
FRA = "https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_Amtrak_Routes/FeatureServer/0"
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
REQUESTS = []
WARNINGS = []


def project(lon, lat, z=None):
    return ((R * math.radians(lon) - X0) * K,
            (R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) - Y0) * K)


def unproject(e, n, z=None):
    return (math.degrees((e / K + X0) / R),
            math.degrees(2 * math.atan(math.exp((n / K + Y0) / R)) - math.pi / 2))


def json_write(path, value, pretty=False):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2 if pretty else None,
                               separators=None if pretty else (",", ":")) + "\n")


class CacheIdentityError(RuntimeError):
    """The requested acquisition no longer matches the retained source snapshot."""


def decode_json(data, name):
    result = json.loads(data)
    if not isinstance(result, dict):
        raise RuntimeError(f"{name}: expected a JSON object")
    if "error" in result or result.get("remark"):
        raise RuntimeError(f"{name}: {result.get('error') or result.get('remark')}")
    return result


def fetch(name, url, body=None, refresh=False, compressed=True, validator=None):
    """Retain only accepted responses in the current staging directory.

    A cache hit must match both request identity and content checksum. Response
    validation precedes writes and provenance registration, including on fallback.
    """
    path = ROOT / "sources" / (name + (".gz" if compressed else ""))
    info_path = ROOT / "sources" / (name + ".request.json")
    identity = {"url": url, "method": "POST" if body is not None else "GET",
                "body": body.decode() if body is not None else None}
    cached = not refresh and path.exists() and info_path.exists()
    if cached:
        info = json.loads(info_path.read_text())
        if any(info.get(key) != value for key, value in identity.items()):
            raise CacheIdentityError(f"Cached request identity changed for {name}; rerun with --refresh")
        data = gzip.decompress(path.read_bytes()) if compressed else path.read_bytes()
        if hashlib.sha256(data).hexdigest() != info["responseSha256"]:
            raise RuntimeError(f"Corrupt cached source: {name}")
    else:
        req = urllib.request.Request(url, data=body,
                                     headers={"User-Agent": "ChillWindow-GIS/1.0 (source-backed scenery)",
                                              "Content-Type": "application/x-www-form-urlencoded",
                                              "Accept": "*/*"})
        print(f"Fetching {name}: {url[:160]}", flush=True)
        with urllib.request.urlopen(req, timeout=240) as response:
            data = response.read()
            content_type = response.headers.get("Content-Type")
        info = {**identity, "retrievedAt": DATE,
                "contentType": content_type, "responseBytes": len(data),
                "responseSha256": hashlib.sha256(data).hexdigest()}
    if validator:
        validator(data)
    if not cached:
        path.write_bytes(gzip.compress(data, mtime=0) if compressed else data)
        json_write(info_path, info, True)
    snapshot = str(path.relative_to(ROOT))
    REQUESTS[:] = [request for request in REQUESTS if request["snapshot"] != snapshot]
    REQUESTS.append({"snapshot": snapshot, **info})
    return data, info


def get_json(name, base, params=None, refresh=False):
    url = base + ("?" + urllib.parse.urlencode(params) if params else "")
    data, info = fetch(name, url, refresh=refresh, validator=lambda value: decode_json(value, name))
    return decode_json(data, name), info


def geometries(geom, kind):
    if geom.is_empty:
        return []
    if geom.geom_type == kind:
        return [geom]
    if hasattr(geom, "geoms"):
        return [g for part in geom.geoms for g in geometries(part, kind)]
    return []


def coords(sequence):
    return [[round(x, 9), round(y, 9)] for x, y in sequence]


def prepare_dem(refresh):
    metadata, _ = get_json("usgs-service.json", USGS, {"f": "pjson"}, refresh)
    west, south = project(BBOX[0], BBOX[1])
    east, north = project(BBOX[2], BBOX[3])
    width = math.ceil((east - west) / 20)
    height = math.ceil((north - south) / 20)
    mercator_bbox = [west / K + X0, south / K + Y0, east / K + X0, north / K + Y0]
    export, _ = get_json("usgs-export.json", USGS + "/exportImage", {
        "f": "pjson", "bbox": ",".join(map(str, mercator_bbox)),
        "bboxSR": "3857", "imageSR": "3857", "size": f"{width},{height}",
        "format": "tiff", "pixelType": "F32", "interpolation": "RSP_BilinearInterpolation",
        "renderingRule": json.dumps({"rasterFunction": "None"}, separators=(",", ":")),
        "adjustAspectRatio": "false", "noDataInterpretation": "esriNoDataMatchAny"
    }, refresh)
    def validate_tiff(value):
        raster = Image.open(io.BytesIO(value))
        if raster.mode != "F" or raster.size != (width, height):
            raise RuntimeError(f"Unexpected DEM: mode={raster.mode}, size={raster.size}")
        pixels = raster.get_flattened_data() if hasattr(raster, "get_flattened_data") else raster.getdata()
        if not all(math.isfinite(v) and -100 <= v <= 1500 for v in pixels):
            raise RuntimeError("DEM has nonfinite, missing or unrealistic values")
    data, _ = fetch("usgs-elevation.tiff", export["href"], refresh=refresh, compressed=False,
                    validator=validate_tiff)
    image = Image.open(io.BytesIO(data))
    if image.mode != "F" or image.size != (width, height):
        raise RuntimeError(f"Unexpected DEM: mode={image.mode}, size={image.size}")
    values = array.array("f", image.get_flattened_data() if hasattr(image, "get_flattened_data") else image.getdata())
    if not all(math.isfinite(v) and -100 <= v <= 1500 for v in values):
        raise RuntimeError("DEM has nonfinite, missing or unrealistic values; do not fabricate replacements")
    flipped = array.array("f")
    for row in range(height - 1, -1, -1):
        flipped.extend(values[row * width:(row + 1) * width])
    if sys.byteorder != "little":
        flipped.byteswap()
    (ROOT / "elevation.f32").write_bytes(flipped.tobytes())
    extent = export["extent"]
    min_e = (extent["xmin"] - X0) * K
    max_e = (extent["xmax"] - X0) * K
    min_n = (extent["ymin"] - Y0) * K
    max_n = (extent["ymax"] - Y0) * K
    dx, dn = (max_e - min_e) / width, (max_n - min_n) / height
    pixel_scale = image.tag_v2.get(33550)
    tiepoint = image.tag_v2.get(33922)
    if not pixel_scale or not tiepoint or not (
        math.isclose(pixel_scale[0] * K, dx, abs_tol=1e-7)
        and math.isclose(pixel_scale[1] * K, dn, abs_tol=1e-7)
        and math.isclose(tiepoint[3], extent["xmin"], abs_tol=1e-7)
        and math.isclose(tiepoint[4], extent["ymax"], abs_tol=1e-7)
    ):
        raise RuntimeError("GeoTIFF georeferencing disagrees with exported pixel grid")
    dem = {"width": width, "height": height,
           "bounds": [min_e + dx / 2, min_n + dn / 2, max_e - dx / 2, max_n - dn / 2],
           "resolution": [dx, dn], "file": "elevation.f32", "rowOrder": "south-to-north",
           "units": "metres", "source": USGS, "range": [min(values), max(values)]}
    return dem, metadata


def prepare_route(refresh):
    get_json("fra-service.json", FRA, {"f": "pjson"}, refresh)
    geojson, info = get_json("fra-empire-service.geojson", FRA + "/query", {
        "where": "name='Empire Service'", "outFields": "name,ROUTE_URL", "f": "geojson",
        "outSR": "4326", "returnGeometry": "true"
    }, refresh)
    paths = []
    clip = box(-74.00, 41.27, -73.85, 41.44)
    for feature in geojson["features"]:
        geometry = feature["geometry"]
        source_lines = [geometry["coordinates"]] if geometry["type"] == "LineString" else geometry["coordinates"]
        for line in source_lines:
            paths.extend(geometries(LineString(line).intersection(clip), "LineString"))
    if not paths:
        raise RuntimeError("Official Empire Service line has no segment in requested corridor")
    route = max(paths, key=lambda line: transform(project, line).length)
    points = list(route.coords)
    if points[0][1] < points[-1][1]:
        points.reverse()
    return {"name": "Empire Service · Hudson Highlands · southbound", "points": coords(points),
            "source": info["url"], "lengthMetres": transform(project, route).length}


def feature_kind(tags):
    if tags.get("natural") == "water" or tags.get("waterway") == "riverbank" or tags.get("landuse") == "reservoir":
        return "water"
    if tags.get("natural") == "wood" or tags.get("landuse") == "forest":
        return "forest"
    if tags.get("landuse") in ("farmland", "orchard", "vineyard"):
        return "farmland"
    if "building" in tags and tags["building"] != "no":
        return "building"
    if "railway" in tags:
        return "rail"
    if "highway" in tags:
        return "road"
    return None


def member_lines(relation, role):
    result = []
    for member in relation.get("members", []):
        member_role = member.get("role", "") or "outer"
        if member["type"] != "way" or member_role != role:
            continue
        points = [(v["lon"], v["lat"]) for v in member.get("geometry", []) if v]
        if len(points) >= 2:
            result.append(LineString(points))
    return result


def relation_polygons(relation):
    outer_lines = member_lines(relation, "outer")
    inner_lines = member_lines(relation, "inner")
    outers = list(polygonize(outer_lines))
    inners = list(polygonize(inner_lines))
    if not outers:
        WARNINGS.append(f"relation/{relation['id']}: no complete outer polygon")
        return []
    outer_length = sum(line.length for line in outer_lines)
    closed_length = sum(p.exterior.length for p in outers)
    if abs(outer_length - closed_length) > 0.000001:
        WARNINGS.append(f"relation/{relation['id']} ({relation.get('tags', {}).get('name', 'unnamed')}): unclosed outer line fragments excluded")
    assigned = collections.defaultdict(list)
    for inner in inners:
        containing = [(i, poly.area) for i, poly in enumerate(outers) if poly.covers(inner.representative_point())]
        if containing:
            assigned[min(containing, key=lambda entry: entry[1])[0]].append(list(inner.exterior.coords))
        else:
            WARNINGS.append(f"relation/{relation['id']}: orphan inner ring excluded")
    return [Polygon(poly.exterior.coords, assigned[i]) for i, poly in enumerate(outers)]


def prepare_features(refresh, route):
    south, west, north, east = BBOX[1], BBOX[0], BBOX[3], BBOX[2]
    region = f"({south},{west},{north},{east})"
    groups = {
        "water": f'''
  way["natural"~"^(water|wood)$"]{region};
  relation["type"="multipolygon"]["natural"~"^(water|wood)$"]{region};
  way["waterway"="riverbank"]{region};
  relation["type"="multipolygon"]["waterway"="riverbank"]{region};
''',
        "land": f'''
  way["landuse"~"^(forest|farmland|orchard|vineyard|reservoir)$"]{region};
  relation["type"="multipolygon"]["landuse"~"^(forest|farmland|orchard|vineyard|reservoir)$"]{region};
''',
        "buildings": f'''
  way["building"]["building"!="no"]{region};
  relation["type"="multipolygon"]["building"]["building"!="no"]{region};
''',
        "transport": f'''
  way["highway"]{region};
  way["railway"~"^(rail|light_rail|tram|narrow_gauge|disused|abandoned)$"]{region};
'''}
    merged = {}
    snapshots = []
    for group, clauses in groups.items():
        query = "[out:json][timeout:90][maxsize:134217728];\n(\n" + clauses + ");\nout body geom;\n"
        (ROOT / f"sources/overpass-{group}.ql").write_text(query)
        query_string = "?" + urllib.parse.urlencode({"data": query})
        endpoints = list(OVERPASS)
        cached_endpoint = False
        sidecar = ROOT / f"sources/osm-{group}.json.request.json"
        snapshot = ROOT / f"sources/osm-{group}.json.gz"
        if not refresh and sidecar.exists() and snapshot.exists():
            # A successful fallback is a legitimate snapshot source. Replay that
            # exact approved endpoint while still rejecting every query edit.
            cached_url = json.loads(sidecar.read_text()).get("url")
            matching = [endpoint for endpoint in endpoints if endpoint + query_string == cached_url]
            if not matching:
                raise CacheIdentityError(f"Cached request identity changed for osm-{group}.json; rerun with --refresh")
            endpoints = matching
            cached_endpoint = True
        for index, endpoint in enumerate(endpoints):
            try:
                url = endpoint + query_string
                def validate_osm(value):
                    response = decode_json(value, f"osm-{group}")
                    if not isinstance(response.get("elements"), list):
                        raise RuntimeError(f"osm-{group}: missing elements array")
                data, info = fetch(f"osm-{group}.json", url, refresh=refresh or index > 0,
                                   validator=validate_osm)
                osm = decode_json(data, f"osm-{group}")
                break
            except CacheIdentityError:
                raise
            except Exception as error:
                if cached_endpoint:
                    # Damaged or rejected cached content requires an explicit
                    # refresh; offline replay never silently switches to network.
                    raise
                print(f"Overpass {group} source failed: {error}", flush=True)
        else:
            raise RuntimeError(f"All public Overpass endpoints failed for {group}")
        snapshots.append(osm.get("osm3s", {}))
        for element in osm["elements"]:
            merged[(element["type"], element["id"])] = element
    elements = list(merged.values())
    polygon_relations = [e for e in elements if e["type"] == "relation" and feature_kind(e.get("tags", {}))]
    represented_members = {m["ref"] for r in polygon_relations for m in r.get("members", []) if m["type"] == "way"}
    clipping = box(*BBOX)
    corridor = transform(project, LineString(route["points"])).buffer(1200)
    features = []
    for element in elements:
        kind = feature_kind(element.get("tags", {}))
        if not kind:
            continue
        identifier = f"osm/{element['type']}/{element['id']}"
        tags = element.get("tags", {})
        if element["type"] == "relation":
            shapes = relation_polygons(element)
        elif element["type"] == "way":
            points = [(p["lon"], p["lat"]) for p in element.get("geometry", []) if p]
            if len(points) < 2:
                continue
            if kind in ("road", "rail"):
                shapes = [LineString(points)]
            elif element["id"] not in represented_members and len(points) >= 4 and points[0] == points[-1]:
                shapes = [Polygon(points)]
            else:
                continue
        else:
            continue
        pieces = []
        shape_type = "LineString" if kind in ("road", "rail") else "Polygon"
        for shape in shapes:
            valid = make_valid(shape) if not shape.is_valid else shape
            clipped = valid.intersection(clipping)
            if kind == "building":
                # Select by footprint intersection, keeping the complete measured
                # footprint rather than cutting buildings at a corridor boundary.
                if not transform(project, clipped).intersects(corridor):
                    continue
            elif kind == "road":
                clipped = transform(unproject, transform(project, clipped).intersection(corridor))
            pieces.extend(geometries(clipped, shape_type))
        for part_index, piece in enumerate(pieces):
            # At most 1.5 m geometric simplification; actual shoreline remains source-derived.
            metric = transform(project, piece)
            if kind != "building":
                metric = metric.simplify(1.5, preserve_topology=True)
            derived = transform(unproject, metric)
            if derived.is_empty:
                continue
            # Topology-preserving quantization avoids invalid rings where source
            # members touch. A 1e-9 degree grid is below source coordinate accuracy.
            derived = set_precision(make_valid(derived) if not derived.is_valid else derived, 1e-9)
            for sub_index, clean in enumerate(geometries(derived, shape_type)):
                suffix = f"/{part_index}/{sub_index}" if len(pieces) > 1 or sub_index else ""
                feature = {"id": identifier + suffix,
                           "kind": kind, "coordinates": coords(clean.exterior.coords if shape_type == "Polygon" else clean.coords),
                           "tags": tags}
                if shape_type == "Polygon" and clean.interiors:
                    feature["holes"] = [coords(ring.coords) for ring in clean.interiors]
                features.append(feature)
    metadata = {"snapshots": snapshots,
                "timestamp_osm_base": min(s.get("timestamp_osm_base", DATE) for s in snapshots)}
    return features, metadata, info


def validate(world):
    dem = world["dem"]
    min_e, min_n, max_e, max_n = dem["bounds"]
    for lon, lat in world["route"]["points"]:
        e, n = project(lon, lat)
        if not min_e <= e <= max_e or not min_n <= n <= max_n:
            raise RuntimeError("Route point outside DEM pixel-centre coverage")
    for feature in world["features"]:
        if feature["kind"] not in ("road", "rail"):
            rings = [feature["coordinates"], *feature.get("holes", [])]
            if not all(len(ring) >= 4 and ring[0] == ring[-1] for ring in rings):
                raise RuntimeError(f"Unclosed area ring: {feature['id']}")
            if not Polygon(rings[0], rings[1:]).is_valid:
                raise RuntimeError(f"Invalid rounded polygon: {feature['id']}")
    expected = dem["width"] * dem["height"] * 4
    if (ROOT / "elevation.f32").stat().st_size != expected:
        raise RuntimeError("DEM byte count mismatch")


def build_bundle(refresh):
    """Prepare the entire bundle under ROOT; run_transaction sets a private stage."""
    (ROOT / "sources").mkdir(parents=True, exist_ok=True)
    dem, usgs_metadata = prepare_dem(refresh)
    route = prepare_route(refresh)
    features, osm_metadata, osm_request = prepare_features(refresh, route)
    retrieval_dates = {request["snapshot"]: request["retrievedAt"] for request in REQUESTS}
    world = {"origin": ORIGIN, "bounds": BBOX, "route": route, "dem": dem, "features": features,
             "sources": [
                 {"name": "USGS 3DEP bare-earth elevation", "url": USGS, "date": retrieval_dates["sources/usgs-elevation.tiff"],
                  "description": usgs_metadata["serviceDescription"], "attribution": "USGS National Map 3D Elevation Program; public domain"},
                 {"name": "FRA/BTS NTAD Amtrak Routes", "url": FRA, "date": retrieval_dates["sources/fra-empire-service.geojson.gz"],
                  "description": "Official Empire Service centreline clipped to Hudson Highlands, reversed southbound; federal public data"},
                 {"name": "OpenStreetMap contributors", "url": "https://www.openstreetmap.org/copyright", "date": osm_metadata.get("timestamp_osm_base", DATE),
                  "description": "Mapped water, wooded land, agriculture, buildings, roads and rail; ODbL 1.0. Multipolygon members assembled before clipping. Buildings selected intact and roads clipped to a 1200 m route corridor. Other vectors use 1.5 m topology-preserving simplification."}
             ]}
    validate(world)
    json_write(ROOT / "world.json", world)
    counts = dict(collections.Counter(f["kind"] for f in features))
    manifest = {"generatedAt": DATE, "bounds": BBOX, "origin": ORIGIN,
                "dependencies": {"python": sys.version, "Pillow": PIL.__version__, "shapely": shapely.__version__},
                "featureCoverage": {"building": "Whole unsimplified footprints intersecting a 1200 m route buffer", "road": "Clipped to 1200 m route buffer", "waterForestFarmlandRail": "Full regional bbox"},
                "projection": "E=(R*lonRad-R*originLonRad)*cos(originLat); N=(R*ln(tan(pi/4+latRad/2))-R*ln(tan(pi/4+originLatRad/2)))*cos(originLat); R=6378137",
                "coordinateConvention": "Longitude/latitude in world.json features; local east/north metres for DEM pixel-centre bounds; little-endian Float32 south-to-north rows, west-to-east columns.",
                "requests": REQUESTS, "osmMetadata": osm_metadata,
                "validation": {"routePoints": len(route["points"]), "routeLengthMetres": route["lengthMetres"],
                               "demFinite": True, "demRangeMetres": dem["range"], "demResolutionMetres": dem["resolution"],
                               "routeInsideDEM": True, "areaRingsClosedAndValid": True,
                               "featureCounts": counts, "waterHoles": sum(len(f.get("holes", [])) for f in features if f["kind"] == "water")},
                "knownGaps": ["OSM coverage is community-maintained and incomplete; absent features are not inferred.",
                              "DEM is bare earth, not a surface model; buildings and vegetation heights are not measured by this raster.",
                              "USGS 3DEP dynamic service combines source resolutions/dates; 20 m export sampling is not a claim of native source resolution.",
                              "The official route is a cartographic line and does not provide exact track elevation or travel timetable.",
                              "No imagery textures or measured vegetation species/heights included.", *WARNINGS]}
    manifest["files"] = {str(p.relative_to(ROOT)): {"bytes": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                         for p in sorted(ROOT.rglob("*")) if p.is_file() and p.name not in ("manifest.json", "README.md")}
    json_write(ROOT / "manifest.json", manifest, True)
    (ROOT / "README.md").write_text(f'''# Hudson Highlands source-backed scenery

Generated: {DATE}. Route: {route["lengthMetres"] / 1000:.2f} km southbound.

`world.json` contains longitude/latitude vectors and local east/north DEM metadata.
`elevation.f32` stores {dem["width"]} × {dem["height"]} little-endian Float32 elevation
metres, west-to-east columns and south-to-north rows. Bounds identify **pixel
centres**, so use `(coordinate - min) / resolution` for bilinear sampling.
DEM range: {dem["range"][0]:.2f} to {dem["range"][1]:.2f} m. Sampling:
{dem["resolution"][0]:.3f} × {dem["resolution"][1]:.3f} ground metres.

Feature counts: {json.dumps(counts)}. Water holes retained:
{manifest["validation"]["waterHoles"]}.

Buildings preserve complete mapped footprints intersecting a 1200 m route
corridor; roads are clipped to that corridor. Water and wooded land retain full
regional coverage, simplified with preserved topology at 1.5 m tolerance.
Source geometry warnings: {"; ".join(WARNINGS) or "none"}. The hospital relation
warning does not affect any Hudson River shoreline.

Rebuild with `python app/scripts/prepare-hudson.py` using Pillow and shapely.
The script reuses checked source snapshots; `--refresh` requests current data.
All preparation runs in a private staging directory. Only a fully validated
bundle is published; failures preserve the previous sources and rendered data.
Cache request identities must match; changed requests require `--refresh`.
`manifest.json` records exact requests, checksums, verification and known gaps;
`sources/` retains the original government and OSM responses.

Sources and attribution:
- [USGS 3DEP ImageServer]({USGS}): bare-earth elevations; public domain.
- [FRA/BTS NTAD Amtrak Routes]({FRA}): Empire Service route; federal public data.
- [OpenStreetMap contributors](https://www.openstreetmap.org/copyright):
  vectors licensed under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
  This bundle contains an adapted OpenStreetMap database. Retain attribution and
  the applicable ODbL terms when redistributing its vector data.
- [Overpass API documentation](https://wiki.openstreetmap.org/wiki/Overpass_API).

Map data represents mapped objects, not a surveyed engineering model. Railway
centreline accuracy, missing OSM coverage and the DEM source mosaic are described
in the manifest. No terrain or shoreline was procedurally fabricated.
''')
    print(json.dumps(manifest["validation"], indent=2), flush=True)
    print(f"Warnings: {WARNINGS}", flush=True)


def validate_bundle():
    """Check published-file semantics and provenance together before promotion."""
    world = json.loads((ROOT / "world.json").read_text())
    validate(world)
    manifest = json.loads((ROOT / "manifest.json").read_text())
    for relative, info in manifest["files"].items():
        data = (ROOT / relative).read_bytes()
        if len(data) != info["bytes"] or hashlib.sha256(data).hexdigest() != info["sha256"]:
            raise RuntimeError(f"Bundle checksum mismatch: {relative}")
    snapshots = set()
    for request in manifest["requests"]:
        relative = request["snapshot"]
        if relative in snapshots:
            raise RuntimeError(f"Duplicate provenance snapshot: {relative}")
        snapshots.add(relative)
        data = (ROOT / relative).read_bytes()
        if relative.endswith(".gz"):
            data = gzip.decompress(data)
        if hashlib.sha256(data).hexdigest() != request["responseSha256"]:
            raise RuntimeError(f"Source checksum mismatch: {relative}")
    ids = [feature["id"] for feature in world["features"]]
    if len(ids) != len(set(ids)):
        raise RuntimeError("Duplicate feature IDs")


def run_transaction(refresh, destination=None):
    """Publish a complete sibling stage, restoring the old directory on failure.

    Directory renames stay on one filesystem. A failed second rename rolls back
    the first; if rollback itself fails, the retained backup path is reported.
    """
    global ROOT
    previous_root = ROOT
    destination = Path(destination) if destination is not None else ROOT
    destination.parent.mkdir(parents=True, exist_ok=True)
    holder = Path(tempfile.mkdtemp(prefix=f".{destination.name}-stage-", dir=destination.parent))
    stage, backup = holder / "bundle", holder / "previous"
    preserve_backup = False
    published = False
    REQUESTS.clear()
    WARNINGS.clear()
    try:
        if destination.exists():
            shutil.copytree(destination, stage)
        else:
            stage.mkdir()
        ROOT = stage
        build_bundle(refresh)
        validate_bundle()
        if destination.exists():
            os.replace(destination, backup)
        try:
            os.replace(stage, destination)
            published = True
        except BaseException:
            if backup.exists():
                try:
                    os.replace(backup, destination)
                except BaseException as rollback_error:
                    preserve_backup = True
                    raise RuntimeError(f"Publish rollback failed; previous bundle retained at {backup}") from rollback_error
            raise
    finally:
        ROOT = previous_root
        # Never delete the previous good directory if promotion was interrupted
        # between renames (including asynchronous KeyboardInterrupt).
        if backup.exists() and not published:
            preserve_backup = True
            print(f"Previous bundle preserved for recovery at {backup}", file=sys.stderr)
        if not preserve_backup:
            shutil.rmtree(holder)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    run_transaction(args.refresh)


if __name__ == "__main__":
    main()
