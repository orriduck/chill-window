#!/usr/bin/env python3
"""Convert source-height buildings in the Hudson route corridor to tiled GLBs.

Uses the checked-in world.json + buildings.json and official OSM2World 0.4.0.
No building is assigned a guessed height. Source-tagged heights and explicit
upstream model estimates are passed as height tags but remain distinguished in
the sidecar. Shelter objects are kept in the manifest/footprint catalogue and
never emitted as closed building meshes.

Requires Python 3 + GDAL/OGR Python bindings. Default mode only writes a plan;
use --tiles all or --tiles X,Y ... to run the converter.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

from osgeo import ogr, osr

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
GEO = REPO / "app/public/geodata/hudson"
WORLD = GEO / "world.json"
BUILDINGS = GEO / "buildings.json"
OUT = HERE / "output"
TILE_M = 256
CORRIDOR_M = 1200
OSM2WORLD_VERSION = "0.4.0"
OSM2WORLD_RELEASE = "https://osm2world.org/download/files/0.4.0/OSM2World-0.4.0-bin.zip"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def digest(path: Path) -> str:
    return sha(path.read_bytes())


def save(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def transform_factory():
    src, dst = osr.SpatialReference(), osr.SpatialReference()
    src.ImportFromEPSG(4326)
    dst.ImportFromEPSG(26918)  # NAD83 / UTM zone 18N, metres
    src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    dst.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return osr.CoordinateTransformation(src, dst)


def project_ring(coords, tx):
    ring = ogr.Geometry(ogr.wkbLinearRing)
    for lon, lat in coords:
        x, y, _ = tx.TransformPoint(float(lon), float(lat))
        ring.AddPoint_2D(x, y)
    return ring


def polygon_geometry(coords, holes, tx):
    polygon = ogr.Geometry(ogr.wkbPolygon)
    polygon.AddGeometry(project_ring(coords, tx))
    for hole in holes or []:
        polygon.AddGeometry(project_ring(hole, tx))
    return polygon


def route_geometry(points, tx):
    line = ogr.Geometry(ogr.wkbLineString)
    for lon, lat in points:
        x, y, _ = tx.TransformPoint(float(lon), float(lat))
        line.AddPoint_2D(x, y)
    return line


def tile_key(x, y, origin_x, origin_y):
    return (math.floor((x - origin_x) / TILE_M), math.floor((origin_y - y) / TILE_M))


def clean_tags(tags):
    """Copy source tags and map retained Overture appearance fields to OSM keys."""
    out = {str(k): str(v) for k, v in (tags or {}).items() if v is not None}
    return out


def feature_tags(feature, building_height):
    tags = clean_tags(feature.get("tags"))
    props = feature.get("overtureProperties", {})
    if feature.get("kind") == "building_part":
        tags["building:part"] = tags.get("building:part", "yes")
        tags.setdefault("building", "yes")
    else:
        tags.setdefault("building", "yes")
    # Geometry uses a numeric metre value only when the data explicitly has one.
    tags["height"] = format(float(building_height["metres"]), ".9g")
    if props.get("min_height") is not None:
        tags["min_height"] = str(props["min_height"])
    mapping = {
        "roof_shape": "roof:shape", "roof_material": "roof:material",
        "roof_colour": "roof:colour", "roof_color": "roof:colour",
        "roof_height": "roof:height", "roof_orientation": "roof:orientation",
        "facade_material": "building:material", "facade_color": "building:colour",
    }
    for source_key, osm_key in mapping.items():
        value = props.get(source_key)
        if value is not None:
            tags.setdefault(osm_key, str(value))
    # Stable experiment annotations; OSM2World ignores these, sidecar is authoritative.
    tags["chill:source_id"] = str(feature["id"])
    tags["chill:height_status"] = str(building_height["status"])
    return tags


def stable_osm_number(source_id: str) -> int:
    # IDs are only OSM2World transport keys. The sidecar maps them to exact source IDs.
    return int(hashlib.sha256(source_id.encode()).hexdigest()[:14], 16) + 1_000_000_000


def ring_is_closed(ring):
    return len(ring) >= 4 and ring[0][:2] == ring[-1][:2]


def source_rings(feature):
    coords = feature.get("coordinates")
    if coords is None:
        geometry = feature.get("geometry", {})
        geom_coords = geometry.get("coordinates", [])
        if geometry.get("type") == "Polygon":
            coords = geom_coords[0] if geom_coords else []
            holes = geom_coords[1:]
        elif geometry.get("type") == "MultiPolygon":
            # The current prepared overlay has single components per record.
            # MultiPolygon parts are expanded here with stable suffixed records.
            return [(poly[0], poly[1:]) for poly in geom_coords]
        else:
            return []
    else:
        holes = feature.get("holes", [])
    return [(coords, holes)]


def is_shelter(feature):
    tags = feature.get("tags", {})
    return (tags.get("amenity") == "shelter" or
            tags.get("shelter_type") == "public_transport")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--world", type=Path, default=WORLD)
    ap.add_argument("--buildings", type=Path, default=BUILDINGS)
    ap.add_argument("--output", type=Path, default=OUT)
    ap.add_argument("--osm2world", default=os.environ.get("OSM2WORLD_BIN"))
    ap.add_argument("--tiles", nargs="+", default=[], help="all or tile keys like 4,-2")
    ap.add_argument("--lod", default="2", choices=list("01234"))
    ap.add_argument("--workers", type=int, default=4, help="parallel OSM2World processes; default 4")
    args = ap.parse_args()

    world_raw, building_raw = args.world.read_bytes(), args.buildings.read_bytes()
    world, overlay = json.loads(world_raw), json.loads(building_raw)
    expected_world_sha = "c4a2eaea1d1ffc3d1f9c346dcceb812f10a4efb9755da146d4c18249002393ec"
    if sha(world_raw) != expected_world_sha:
        raise SystemExit(f"world.json SHA mismatch: expected {expected_world_sha}, got {sha(world_raw)}")
    if overlay.get("baseWorldSha256") != expected_world_sha:
        raise SystemExit("buildings overlay was not prepared against the requested world.json")

    ogr.UseExceptions()
    osr.UseExceptions()
    tx = transform_factory()
    route = route_geometry(world["route"]["points"], tx)
    corridor = route.Buffer(CORRIDOR_M)
    origin_x, origin_y, _ = tx.TransformPoint(*world["route"]["points"][0])
    buckets = defaultdict(list)
    all_records, statuses, source_counts = [], Counter(), Counter()
    part_by_parent = defaultdict(list)
    for part in overlay.get("buildingParts", []):
        part_by_parent[part.get("parentFeatureId")].append(part)

    # Main overlay uses one polygon component per output record.
    for feature in overlay["features"]:
        height = feature.get("buildingHeight", {})
        polygons = source_rings(feature)
        if not polygons:
            continue
        poly_parts = [polygon_geometry(outer, holes, tx) for outer, holes in polygons]
        # Current overlay is componentized; multipolygons are assigned by each piece's centroid.
        for part_index, poly in enumerate(poly_parts):
            if not poly.Intersects(corridor):
                continue
            centroid = poly.Centroid()
            key = tile_key(centroid.GetX(), centroid.GetY(), origin_x, origin_y)
            record = {"feature": feature, "rings": polygons[part_index],
                      "partIndex": part_index, "tile": key, "height": height}
            all_records.append(record)
            statuses[height.get("status", "missing")] += 1
            if height.get("metres") is not None:
                source_counts.update(height.get("sourceDatasets", []))
            if is_shelter(feature):
                record["skipReason"] = "open_shelter_semantics"
            elif height.get("metres") is None:
                record["skipReason"] = "no_source_height"
            else:
                buckets[key].append(record)

    # Add source parts to their parent's bucket so OSM2World can resolve building-part adjacency.
    for parent_id, parts in part_by_parent.items():
        parent_records = [r for r in all_records if r["feature"]["id"] == parent_id]
        parent_key = parent_records[0]["tile"] if parent_records else None
        for part in parts:
            height = part.get("buildingHeight", {})
            geom = part.get("geometry", {})
            if height.get("metres") is None or geom.get("type") != "Polygon":
                continue
            rings = geom.get("coordinates", [])
            if not rings:
                continue
            poly = polygon_geometry(rings[0], rings[1:], tx)
            if not poly.Intersects(corridor):
                continue
            centroid = poly.Centroid()
            key = parent_key or tile_key(centroid.GetX(), centroid.GetY(), origin_x, origin_y)
            buckets[key].append({"feature": {"id": "building_part/" + part["id"],
                "kind": "building_part", "tags": {}, "overtureProperties": part.get("properties", {}),
                "provenance": {"geometry": {"dataset": "Overture Maps", "gersId": part["id"]}},
                "parentFeatureId": parent_id},
                "rings": (rings[0], rings[1:]), "partIndex": 0, "tile": key, "height": height,
                "buildingPart": part})

    plan_tiles = sorted(buckets)
    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    source_attribute_coverage = Counter()
    for record in all_records:
        props = record["feature"].get("overtureProperties", {})
        tags = record["feature"].get("tags", {})
        for key in ("roof_shape", "roof_material", "roof_colour", "roof_color", "roof_height",
                    "facade_material", "facade_color"):
            if props.get(key) is not None:
                source_attribute_coverage[key] += 1
        for key in ("roof:shape", "roof:material", "roof:colour", "roof:color", "roof:height",
                    "building:material", "building:colour", "building:color"):
            if tags.get(key) is not None:
                source_attribute_coverage[key] += 1
    excluded_records = []
    for record in all_records:
        if "skipReason" not in record:
            continue
        feature = record["feature"]
        geo = feature.get("provenance", {}).get("geometry", {})
        excluded_records.append({
            "sourceId": feature["id"], "dataset": geo.get("dataset"),
            "sourceRecordId": geo.get("recordId") or geo.get("gersId"),
            "heightMetres": record["height"].get("metres"),
            "heightStatus": record["height"].get("status"),
            "heightMethod": record["height"].get("method"),
            "heightSourceDatasets": record["height"].get("sourceDatasets", []),
            "skipReason": record["skipReason"], "tags": feature.get("tags", {}),
            "footprintReference": "app/public/geodata/hudson/buildings.json#features[id=" + feature["id"] + "]"
        })
    plan = {
        "experiment": "Hudson corridor source-height OSM2World tiled building conversion",
        "createdOn": "2026-10-10",
        "world": {"file": str(args.world), "sha256": sha(world_raw), "routeLengthMetres": world["route"]["lengthMetres"],
                  "routePointCount": len(world["route"]["points"])},
        "buildingOverlay": {"file": str(args.buildings), "sha256": sha(building_raw),
                            "baseWorldSha256": overlay.get("baseWorldSha256"),
                            "overtureRelease": overlay.get("release"),
                            "sourceResponseSha256": [s.get("responseSha256") for s in overlay.get("sources", [])]},
        "selection": {"corridorBufferMetres": CORRIDOR_M, "tileSizeMetres": TILE_M,
                      "tileCRS": "EPSG:26918 NAD83 / UTM zone 18N", "tileOriginRouteStartProjectedMetres": [origin_x, origin_y],
                      "componentsIntersectingCorridor": len(all_records),
                      "componentsByHeightStatus": dict(statuses), "heightSourceDatasets": dict(source_counts),
                      "convertibleBuildingComponents": sum(len(v) for v in buckets.values()),
                      "convertible256mTiles": len(plan_tiles),
                      "sourceAttributesInCorridor": dict(source_attribute_coverage),
                      "sourcePartsInCorridor": sum(1 for items in part_by_parent.values() for p in items
                          if p.get("geometry",{}).get("type")=="Polygon" and
                          polygon_geometry(p["geometry"]["coordinates"][0],p["geometry"]["coordinates"][1:],tx).Intersects(corridor)),
                      "excluded": dict(Counter(r.get("skipReason") for r in all_records if r.get("skipReason")))},
        "osm2world": {"version": OSM2WORLD_VERSION, "release": OSM2WORLD_RELEASE, "license": "MIT",
                       "styleSource": "https://github.com/tordanik/OSM2World-default-style", "styleLicense": "CC0-1.0"},
        "tileKeys": [f"{x},{y}" for x,y in plan_tiles],
        "excludedSourceRecords": excluded_records,
        "partsInCorridor": [{"id":p["id"], "parentFeatureId":p.get("parentFeatureId"),
            "heightMetres":p.get("buildingHeight",{}).get("metres"),
            "heightStatus":p.get("buildingHeight",{}).get("status"),
            "geometrySource":p.get("properties",{}).get("sources",[])}
            for parts in part_by_parent.values() for p in parts
            if p.get("geometry",{}).get("type")=="Polygon" and
            polygon_geometry(p["geometry"]["coordinates"][0],p["geometry"]["coordinates"][1:],tx).Intersects(corridor)],
        "conversions": []
    }
    save(output / "conversion-plan.json", plan)
    if not args.tiles:
        print(json.dumps(plan["selection"], indent=2))
        print(f"Plan saved: {output / 'conversion-plan.json'}")
        return
    selected = plan_tiles if "all" in args.tiles else [tuple(map(int, key.split(","))) for key in args.tiles]
    if not args.osm2world:
        raise SystemExit("Pass --osm2world /path/to/osm2world.sh or set OSM2WORLD_BIN")
    def convert_tile(key):
        records = buckets.get(key, [])
        if not records:
            raise SystemExit(f"no convertible source-height buildings in tile {key}")
        tile_dir = output / f"tile-{key[0]}-{key[1]}"
        tile_dir.mkdir(parents=True, exist_ok=True)
        osm_path, glb_path = tile_dir / "buildings.osm", tile_dir / "buildings.glb"
        source_map, expected = write_osm(records, osm_path)
        manifest_path = tile_dir / "manifest.json"
        if manifest_path.exists() and glb_path.exists():
            previous = json.loads(manifest_path.read_text())
            if previous.get("inputSha256") == digest(osm_path) and previous.get("outputSha256") == digest(glb_path):
                if previous.get("imageStorage") == "content-addressed external images":
                    if any(not item.get("geometryRole") or not item.get("outputNodeBinding") for item in previous.get("sourceRecords", [])):
                        previous["sourceRecords"] = source_map
                    overrides = apply_source_roof_overrides(glb_path, source_map)
                    if overrides or "nodeVerticalBoundsMetres" not in previous.get("analysis", {}):
                        previous["sourceMaterialOverrides"] = overrides
                        previous["outputSha256"], previous["outputBytes"] = digest(glb_path), glb_path.stat().st_size
                        previous["analysis"] = analyze_glb(glb_path, set(previous["analysis"]["sourceNodeIds"]))
                    previous["sourceRecords"] = source_map
                    save(manifest_path, previous)
                    return previous
                # Upgrade prior self-contained GLB in place, keeping geometry bytes.
                converter_sha, converter_bytes = digest(glb_path), glb_path.stat().st_size
                textures = externalize_glb(glb_path, output / "textures")
                analysis = analyze_glb(glb_path, set(previous["analysis"]["sourceNodeIds"]))
                previous.update({"converterOutputSha256": converter_sha,
                    "converterOutputBytes": converter_bytes, "outputSha256": digest(glb_path),
                    "outputBytes": glb_path.stat().st_size, "analysis": analysis,
                    "imageStorage": "content-addressed external images", "textureFiles": textures})
                save(manifest_path, previous)
                return previous
        converter_path = tile_dir / "converter-output.glb"
        command = [args.osm2world, f"--input={osm_path}", f"--output={converter_path}", f"--lod={args.lod}"]
        proc = subprocess.run(command, cwd=tile_dir, text=True, stdout=subprocess.PIPE,
                              stderr=subprocess.STDOUT, check=False)
        (tile_dir / "converter.log").write_text(proc.stdout)
        if proc.returncode:
            raise SystemExit(f"OSM2World failed for tile {key}; inspect {tile_dir / 'converter.log'}")
        converter_sha, converter_bytes = digest(converter_path), converter_path.stat().st_size
        textures = externalize_glb(converter_path, output / "textures", destination=glb_path)
        converter_path.unlink()
        appearance_overrides = apply_source_roof_overrides(glb_path, source_map)
        analysis = analyze_glb(glb_path, expected)
        tile_record = {
            "tileKey": f"{key[0]},{key[1]}", "input": str(osm_path.relative_to(output)),
            "inputSha256": digest(osm_path), "inputBytes": osm_path.stat().st_size,
            "output": str(glb_path.relative_to(output)), "outputSha256": digest(glb_path),
            "outputBytes": glb_path.stat().st_size, "converterOutputSha256": converter_sha,
            "converterOutputBytes": converter_bytes, "imageStorage": "content-addressed external images",
            "textureFiles": textures, "sourceMaterialOverrides":appearance_overrides,"command": command,
            "sourceRecords": source_map, "analysis": analysis,
            "coordinateSystem": "OSM2World local metric projection; see this tile origin below",
            "tileBoundsEPSG26918Metres": tile_bounds(key, origin_x, origin_y),
            "converterInputOriginLonLat": input_origin(records),
            "limitations": ["OSM2World style-derived details/materials are not source observations.",
                            "Only source-known height values were passed; source_estimate remains estimated in source map."]}
        save(manifest_path, tile_record)
        print(f"{key}: buildings={len(expected)} triangles={analysis['triangles']} materials={analysis['materials']} bytes={glb_path.stat().st_size} sha256={digest(glb_path)}")
        return tile_record

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = {executor.submit(convert_tile, key): key for key in selected}
        for future in as_completed(futures):
            tile_record = future.result()
            plan["conversions"].append({k:v for k,v in tile_record.items() if k != "sourceRecords"})
            plan["conversions"].sort(key=lambda x: x["tileKey"])
            save(output / "conversion-plan.json", plan)
    save(output / "conversion-plan.json", plan)
    write_reports(plan, output)


def tile_bounds(key, ox, oy):
    x, y = key
    x0, x1 = ox + x*TILE_M, ox + (x+1)*TILE_M
    y1, y0 = oy - y*TILE_M, oy - (y+1)*TILE_M
    return [x0, y0, x1, y1]


def input_origin(records):
    points = [pt for r in records for ring in [r["rings"][0], *r["rings"][1]] for pt in ring]
    return {"longitude": (min(float(p[0]) for p in points)+max(float(p[0]) for p in points))/2,
            "latitude": (min(float(p[1]) for p in points)+max(float(p[1]) for p in points))/2,
            "derivation": "midpoint of lon/lat extrema of coordinates in this exact tile input"}


def write_osm(records, path):
    root = ET.Element("osm", {"version":"0.6", "generator":"Chill Window sourced corridor tile export"})
    meta = ET.SubElement(root, "meta", {"osm_base":"2026-09-06T00:00:00Z"})
    node_ids, way_ids, source_map, expected = {}, set(), [], set()
    def add_node(point):
        key = (float(point[0]), float(point[1]))
        if key not in node_ids:
            node_ids[key] = str(len(node_ids)+1)
            ET.SubElement(root, "node", {"id":node_ids[key], "lat":format(key[1], '.10f'), "lon":format(key[0], '.10f'), "version":"1"})
        return node_ids[key]
    # Build in-memory elements first; nodes are appended before ways/relations afterward.
    root.remove(meta)
    elements = []
    for record in records:
        feature = record["feature"]
        source_id = feature["id"]
        source_tags = feature.get("tags", {})
        # Never turn a tagged shelter into a solid OSM2World wall mesh.
        if is_shelter(feature):
            continue
        osm_id = source_id.split("/")[-1] if source_id.startswith("osm/way/") else str(stable_osm_number(source_id))
        geom_type = "way" if not record["rings"][1] else "relation"
        if geom_type == "way":
            if osm_id in way_ids: raise ValueError(f"transport OSM id collision {osm_id}")
            way_ids.add(osm_id)
            way = ET.Element("way", {"id":osm_id, "version":"1"})
            for pt in record["rings"][0]: ET.SubElement(way,"nd",{"ref":add_node(pt)})
            tags = feature_tags(feature, record["height"])
            for k,v in tags.items(): ET.SubElement(way,"tag",{"k":k,"v":v})
            elements.append(way); emitted=f"w{osm_id}"
        else:
            relid = osm_id
            rel = ET.Element("relation", {"id":relid, "version":"1"})
            for role,ring in [("outer",record["rings"][0]), *(("inner",r) for r in record["rings"][1])]:
                wid = str(stable_osm_number(f"{source_id}:{role}:{len(elements)}"))
                way = ET.Element("way", {"id":wid,"version":"1"})
                for pt in ring: ET.SubElement(way,"nd",{"ref":add_node(pt)})
                elements.append(way)
                ET.SubElement(rel,"member",{"type":"way","ref":wid,"role":role})
            tags = feature_tags(feature, record["height"])
            # The OSM2World transport geometry must be a multipolygon. Exact source
            # relation tags remain in the sidecar; avoid emitting duplicate type tags.
            tags["type"] = "multipolygon"
            for k,v in tags.items(): ET.SubElement(rel,"tag",{"k":k,"v":v})
            elements.append(rel); emitted=f"r{relid}"
        is_part = feature.get("kind") == "building_part"
        source_map.append({"transportId":emitted,"sourceId":source_id,
            "geometryRole":"building_part" if is_part else "building",
            "sourceDataset":feature.get("provenance",{}).get("geometry",{}).get("dataset"),
            "sourceRecordId":feature.get("provenance",{}).get("geometry",{}).get("recordId") or feature.get("provenance",{}).get("geometry",{}).get("gersId"),
            "parentFeatureId":feature.get("parentFeatureId"),
            "heightMetres":record["height"].get("metres"), "heightStatus":record["height"].get("status"),
            "heightMethod":record["height"].get("method"), "heightSourceDatasets":record["height"].get("sourceDatasets",[]),
            "sourceTags":source_tags, "overtureProperties":feature.get("overtureProperties",{}),
            "mappedGeometryTags":feature_tags(feature, record["height"])})
    source_ids_in_input = {item["sourceId"] for item in source_map}
    transport_ids = {item["sourceId"]:item["transportId"] for item in source_map}
    for item in source_map:
        parent_id = item.get("parentFeatureId")
        if item["geometryRole"] == "building_part" and parent_id in source_ids_in_input:
            item["outputNodeBinding"] = "child_geometry_of:" + transport_ids[parent_id]
        else:
            item["outputNodeBinding"] = "node_extras:" + item["transportId"]
            expected.add(item["transportId"])
    # nodes were appended as they were encountered; reorder to valid OSM document order.
    nodes = [e for e in root.findall("node")]
    root[:] = nodes + elements
    ET.ElementTree(root).write(path, encoding="UTF-8", xml_declaration=True)
    return source_map, expected


def analyze_glb(path, expected_ids):
    import struct
    raw = path.read_bytes()
    if raw[:4] != b"glTF": raise ValueError("converter did not produce GLB")
    total_len, = struct.unpack_from("<I", raw, 8)
    cursor, gltf = 12, None
    while cursor < total_len:
        size, kind = struct.unpack_from("<I4s", raw, cursor); cursor += 8
        chunk = raw[cursor:cursor+size]; cursor += size
        if kind == b"JSON": gltf = json.loads(chunk.rstrip(b" \t\r\n\0"))
    if gltf is None: raise ValueError("GLB JSON chunk missing")
    emitted, triangles, positions = set(), 0, []
    for node in gltf.get("nodes", []):
        oid = node.get("extras", {}).get("osmId")
        if oid: emitted.add(str(oid))
    if emitted != set(expected_ids):
        raise ValueError(f"converter source IDs mismatch missing={set(expected_ids)-emitted} extra={emitted-set(expected_ids)}")
    mesh_bounds = []
    for mesh in gltf.get("meshes",[]):
        for primitive in mesh.get("primitives",[]):
            pos = gltf["accessors"][primitive["attributes"]["POSITION"]]
            positions.append(pos)
            mesh_bounds.append({"min":pos.get("min"),"max":pos.get("max"),
                                "material":gltf.get("materials",[])[primitive["material"]].get("name") if "material" in primitive else None})
            triangles += gltf["accessors"][primitive["indices"]]["count"]//3 if "indices" in primitive else pos["count"]//3
    materials = [m.get("name") for m in gltf.get("materials", [])]
    node_vertical_bounds = {}
    for node_index, node in enumerate(gltf.get("nodes", [])):
        oid = node.get("extras", {}).get("osmId")
        if not oid: continue
        low, high = float("inf"), -float("inf")
        stack = [node_index]; seen = set()
        while stack:
            current = stack.pop()
            if current in seen: continue
            seen.add(current); current_node = gltf["nodes"][current]
            stack.extend(current_node.get("children", []))
            if "mesh" not in current_node: continue
            for primitive in gltf["meshes"][current_node["mesh"]].get("primitives", []):
                accessor = gltf["accessors"][primitive["attributes"]["POSITION"]]
                low = min(low, accessor.get("min", [0,0,0])[1])
                high = max(high, accessor.get("max", [0,0,0])[1])
        node_vertical_bounds[str(oid)] = {"yMinMetres":low,"yMaxMetres":high}
    return {"generator":gltf.get("asset",{}).get("generator"),"sourceNodeIds":sorted(emitted),
            "triangles":triangles,"meshCount":len(gltf.get("meshes",[])),
            "primitiveCount":sum(len(m.get("primitives",[])) for m in gltf.get("meshes",[])),
            "materials":materials,"textureCount":len(gltf.get("textures",[])),
            "nodeVerticalBoundsMetres":node_vertical_bounds,
            "meshPrimitiveBoundsXYZMetres":mesh_bounds,
            "boundsXYZMetres":{"min":[min(p.get("min",[0,0,0])[i] for p in positions) for i in range(3)],
                                "max":[max(p.get("max",[0,0,0])[i] for p in positions) for i in range(3)]}}


def write_reports(plan, output):
    """Write aggregate source-ID audit and sample reports after tiled conversion."""
    records, samples = [], []
    total_glb_bytes = total_converter_bytes = total_triangles = total_meshes = 0
    materials, heights = Counter(), Counter()
    texture_refs, texture_ids = 0, set()
    mismatch_tiles, bad_outputs, bad_textures = [], [], []
    for tile in plan["tileKeys"]:
        tile_dir = output / ("tile-" + tile.replace(",", "-"))
        manifest_path = tile_dir / "manifest.json"
        if not manifest_path.exists():
            bad_outputs.append({"tileKey":tile,"reason":"missing_manifest"})
            continue
        manifest = json.loads(manifest_path.read_text())
        glb_path = output / manifest["output"]
        if not glb_path.exists() or digest(glb_path) != manifest["outputSha256"] or glb_path.stat().st_size != manifest["outputBytes"]:
            bad_outputs.append({"tileKey":tile,"reason":"output_checksum_or_size_mismatch"})
        root_records = [r for r in manifest["sourceRecords"] if r.get("outputNodeBinding", "node_extras:"+r["transportId"]).startswith("node_extras:")]
        mapped = {r["transportId"] for r in root_records}
        emitted = set(manifest["analysis"]["sourceNodeIds"])
        if mapped != emitted or len(mapped) != len(root_records):
            mismatch_tiles.append(tile)
        for item in manifest["sourceRecords"]:
            binding = item.get("outputNodeBinding", "node_extras:"+item["transportId"])
            if binding.startswith("child_geometry_of:") and binding.split(":",1)[1] not in emitted:
                bad_outputs.append({"tileKey":tile,"reason":"building_part_parent_node_missing","sourceId":item["sourceId"]})
        if any(r.get("heightStatus") not in ("source_tag", "source_estimate") or r.get("heightMetres") is None
               for r in manifest["sourceRecords"]):
            bad_outputs.append({"tileKey":tile,"reason":"record_without_source_height"})
        if any(r.get("sourceTags",{}).get("amenity")=="shelter" or
               r.get("sourceTags",{}).get("shelter_type")=="public_transport"
               for r in manifest["sourceRecords"]):
            bad_outputs.append({"tileKey":tile,"reason":"shelter_emitted_as_solid_model"})
        total_glb_bytes += manifest["outputBytes"]
        total_converter_bytes += manifest["converterOutputBytes"]
        total_triangles += manifest["analysis"]["triangles"]
        total_meshes += manifest["analysis"]["meshCount"]
        materials.update(manifest["analysis"]["materials"])
        for rec in manifest["sourceRecords"]:
            heights[rec["heightStatus"]] += 1
            records.append({key:rec.get(key) for key in (
                "transportId","sourceId","sourceDataset","sourceRecordId","parentFeatureId","geometryRole","outputNodeBinding",
                "heightMetres","heightStatus","heightMethod","heightSourceDatasets")} | {"tileKey":tile,
                "outputVerticalBoundsMetres":manifest["analysis"].get("nodeVerticalBoundsMetres",{}).get(rec["transportId"])})
        for texture in manifest.get("textureFiles",[]):
            texture_refs += 1
            texture_ids.add(texture["sha256"])
            texture_path = (tile_dir / texture["uri"]).resolve()
            if not texture_path.exists() or texture_path.stat().st_size != texture["bytes"] or digest(texture_path) != texture["sha256"]:
                bad_textures.append({"tileKey":tile,"uri":texture["uri"]})
        if tile in {"7,7","19,68","15,67"}:
            samples.append({"tileKey":tile,"convertedBuildingCount":len(manifest["sourceRecords"]),
                "converterOutputSha256":manifest["converterOutputSha256"],"converterOutputBytes":manifest["converterOutputBytes"],
                "outputSha256":manifest["outputSha256"],"outputBytes":manifest["outputBytes"],
                "triangles":manifest["analysis"]["triangles"],"meshCount":manifest["analysis"]["meshCount"],
                "materials":manifest["analysis"]["materials"],"boundsXYZMetres":manifest["analysis"]["boundsXYZMetres"],
                "sourceIds":sorted(r["sourceId"] for r in manifest["sourceRecords"])})
    if bad_outputs or mismatch_tiles or bad_textures:
        raise ValueError(f"batch audit failed: outputs={bad_outputs[:5]} idMismatch={mismatch_tiles[:5]} textures={bad_textures[:5]}")
    if len(records) != plan["selection"]["convertibleBuildingComponents"]:
        raise ValueError(f"source mapping count mismatch: {len(records)} vs {plan['selection']['convertibleBuildingComponents']}")
    height_errors = [r["outputVerticalBoundsMetres"]["yMaxMetres"]-r["heightMetres"] for r in records
        if r.get("outputVerticalBoundsMetres") and r.get("geometryRole")!="building_part"]
    records.sort(key=lambda item:(item["tileKey"],item["sourceId"]))
    report_dir = output / "reports"
    summary = {**plan, "aggregateValidation": {
        "tileCount":len(plan["tileKeys"]),"completedTileCount":len(plan["conversions"]),
        "convertedSourceRecordCount":len(records),"heightStatusCounts":dict(heights),
        "totalConverterGLBBytesBeforeSharedTextureExtraction":total_converter_bytes,
        "finalTileGLBBytes":total_glb_bytes,"sharedTextureCount":len(texture_ids),
        "sharedTextureBytes":sum((output/"textures"/name).stat().st_size for name in []),
        "textureReferencesValidated":texture_refs,"triangleCount":total_triangles,"meshCount":total_meshes,
        "sourceHeightComparedWithOutputYMax": {"compared":len(height_errors),"within10cm":sum(abs(e)<=0.1 for e in height_errors),
            "maxAbsoluteErrorMetres":max((abs(e) for e in height_errors),default=None),
            "meanAbsoluteErrorMetres":sum(abs(e) for e in height_errors)/len(height_errors) if height_errors else None},
        "materialNames":dict(materials),"sourceIDSetMismatchedTiles":mismatch_tiles,
        "badOutputs":bad_outputs,"badTextureReferences":bad_textures}}
    # Count unique shared texture bytes once, not once per tile reference.
    summary["aggregateValidation"]["sharedTextureBytes"] = sum(p.stat().st_size for p in (output/"textures").glob("*")) if (output/"textures").exists() else 0
    save(report_dir/"corridor-batch-plan.json", summary)
    save(report_dir/"source-id-map.json", {"schemaVersion":1,"worldSha256":plan["world"]["sha256"],
        "buildingsOverlaySha256":plan["buildingOverlay"]["sha256"],"osm2world":OSM2WORLD_VERSION,"records":records})
    save(report_dir/"sample-validation.json", {"schemaVersion":1,"checks":{
        "worldShaMatchesRequested":plan["world"]["sha256"]=="c4a2eaea1d1ffc3d1f9c346dcceb812f10a4efb9755da146d4c18249002393ec",
        "allTilesHaveManifest":len(plan["conversions"])==len(plan["tileKeys"]),
        "allModelNodeIdsMapToSourceRecords":not mismatch_tiles,
        "heightOnlyConverted":not any(x.get("reason")=="record_without_source_height" for x in bad_outputs),
        "sheltersExcludedFromSolidModels":not any(x.get("reason")=="shelter_emitted_as_solid_model" for x in bad_outputs),
        "sharedTextureFilesHashVerified":not bad_textures,"sourceOutputFilesVerified":not bad_outputs},
        "sampleTiles":samples})


def externalize_glb(source_path, texture_root, destination=None):
    """Move embedded GLB images to shared SHA-named assets and compact BIN data."""
    import struct
    source_path = Path(source_path)
    destination = Path(destination or source_path)
    raw = source_path.read_bytes()
    if raw[:4] != b"glTF": raise ValueError("not a GLB")
    total, = struct.unpack_from("<I", raw, 8)
    cursor, gltf, binary = 12, None, b""
    while cursor < total:
        size, kind = struct.unpack_from("<I4s", raw, cursor); cursor += 8
        chunk = raw[cursor:cursor+size]; cursor += size
        if kind == b"JSON": gltf = json.loads(chunk.rstrip(b" \t\r\n\0"))
        elif kind == b"BIN\0": binary = chunk
    if gltf is None: raise ValueError("GLB JSON chunk missing")
    old_views = gltf.get("bufferViews", [])
    image_views, textures = set(), []
    for image in gltf.get("images", []):
        if "bufferView" not in image:
            continue
        old_index = image["bufferView"]
        view = old_views[old_index]
        start, end = view.get("byteOffset", 0), view.get("byteOffset", 0) + view["byteLength"]
        payload = binary[start:end]
        content_sha = sha(payload)
        mime = image.get("mimeType", "image/jpeg")
        ext = {"image/jpeg":"jpg", "image/png":"png", "image/webp":"webp"}.get(mime)
        if ext is None: raise ValueError(f"unsupported embedded image MIME {mime}")
        texture_root.mkdir(parents=True, exist_ok=True)
        texture_path = texture_root / f"{content_sha}.{ext}"
        if not texture_path.exists() or digest(texture_path) != content_sha:
            # Atomic replace also makes concurrent workers deduplicate safely.
            tmp = texture_path.with_name(texture_path.name + f".{threading.get_ident()}.tmp")
            tmp.write_bytes(payload)
            os.replace(tmp, texture_path)
        image["uri"] = os.path.relpath(texture_path, destination.parent).replace(os.sep, "/")
        image.pop("bufferView", None)
        image.pop("mimeType", None)
        image_views.add(old_index)
        textures.append({"uri":image["uri"], "sha256":content_sha,"bytes":len(payload),"mimeType":mime})
    # Compact all non-image bufferViews and remap their indices/offsets.
    packed, new_views, remap = bytearray(), [], {}
    for old_index, view in enumerate(old_views):
        if old_index in image_views:
            continue
        while len(packed) % 4: packed.append(0)
        start = view.get("byteOffset", 0); size = view["byteLength"]
        new_view = dict(view); new_view["byteOffset"] = len(packed)
        packed.extend(binary[start:start+size])
        remap[old_index] = len(new_views); new_views.append(new_view)
    def update_refs(item):
        if isinstance(item, dict):
            for key, value in list(item.items()):
                if key == "bufferView" and isinstance(value, int):
                    if value not in remap: raise ValueError(f"non-image data references removed bufferView {value}")
                    item[key] = remap[value]
                else: update_refs(value)
        elif isinstance(item, list):
            for value in item: update_refs(value)
    update_refs(gltf)
    gltf["bufferViews"] = new_views
    for buffer in gltf.get("buffers", []): buffer["byteLength"] = len(packed)
    json_chunk = json.dumps(gltf, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    json_chunk += b" " * ((-len(json_chunk)) % 4)
    bin_chunk = bytes(packed); bin_chunk += b"\0" * ((-len(bin_chunk)) % 4)
    chunks = struct.pack("<I4s",len(json_chunk),b"JSON") + json_chunk
    if bin_chunk: chunks += struct.pack("<I4s",len(bin_chunk),b"BIN\0") + bin_chunk
    header = b"glTF" + struct.pack("<II",2,12+len(chunks))
    destination.parent.mkdir(parents=True,exist_ok=True)
    destination.write_bytes(header+chunks)
    return textures


def apply_source_roof_overrides(glb_path, source_records):
    """Apply explicit source roof color/material to recognized roof primitives.

    OSM2World 0.4.0 does not map tar_paper to a dedicated roof material; this
    source-aware PBR override retains the supplied color and names the result as
    a generic source-material appearance, not a photographed material texture.
    """
    import copy, struct
    path=Path(glb_path);raw=path.read_bytes();total,=struct.unpack_from('<I',raw,8);cursor=12;gltf=None;binary=b''
    while cursor<total:
        size,kind=struct.unpack_from('<I4s',raw,cursor);cursor+=8;chunk=raw[cursor:cursor+size];cursor+=size
        if kind==b'JSON':gltf=json.loads(chunk.rstrip(b' \t\r\n\0'))
        elif kind==b'BIN\0':binary=chunk
    if gltf is None:raise ValueError('GLB JSON chunk missing during appearance pass')
    by_transport={r['transportId']:r for r in source_records}
    clones={};overrides=[]
    for node in gltf.get('nodes',[]):
        transport_id=node.get('extras',{}).get('osmId')
        record=by_transport.get(str(transport_id))
        if record is None or record.get('geometryRole')=='building_part':continue
        props=record.get('overtureProperties',{})
        roof_material=props.get('roof_material')
        roof_color=props.get('roof_color') or props.get('roof_colour')
        if roof_material is None and roof_color is None:continue
        applied=False
        stack=list(node.get('children',[]));seen=set()
        while stack:
            ni=stack.pop()
            if ni in seen:continue
            seen.add(ni);child=gltf['nodes'][ni];stack.extend(child.get('children',[]))
            if 'mesh' not in child:continue
            for primitive in gltf['meshes'][child['mesh']].get('primitives',[]):
                if 'material' not in primitive:continue
                old_index=primitive['material'];old=gltf.get('materials',[])[old_index]
                if not str(old.get('name','')).lower().startswith('roof'):continue
                key=(old_index,str(roof_material),str(roof_color))
                if key not in clones:
                    material=copy.deepcopy(old);pbr=material.setdefault('pbrMetallicRoughness',{})
                    if roof_color and re.fullmatch(r'#[0-9a-fA-F]{6}',str(roof_color)):
                        rgb=[int(roof_color[i:i+2],16)/255 for i in (1,3,5)]
                        pbr['baseColorFactor']=[*rgb,1.0]
                    if roof_material:
                        # Source says tar_paper; do not retain an unrelated tile image.
                        if roof_material=='tar_paper':
                            pbr.pop('baseColorTexture',None);pbr.pop('metallicRoughnessTexture',None)
                            pbr['metallicFactor']=0.0;pbr['roughnessFactor']=0.9
                            material.pop('normalTexture',None);material.pop('occlusionTexture',None)
                        material['name']=f"Source roof material {roof_material}"
                    material.setdefault('extras',{}).update({'sourceRoofMaterial':roof_material,
                        'sourceRoofColor':roof_color,'appearanceProxy':True,
                        'note':'Source tag-driven flat PBR appearance; not a local facade/roof photograph.'})
                    clones[key]=len(gltf['materials']);gltf['materials'].append(material)
                primitive['material']=clones[key]
                applied=True
        if applied:
            overrides.append({'sourceId':record['sourceId'],'transportId':record['transportId'],
                'roofMaterial':roof_material,'roofColor':roof_color,'pbrAppearanceProxy':True})
    if not overrides:return []
    json_chunk=json.dumps(gltf,ensure_ascii=False,separators=(',',':')).encode('utf-8');json_chunk+=b' '*((-len(json_chunk))%4)
    bin_chunk=binary;bin_chunk+=b'\0'*((-len(bin_chunk))%4)
    chunks=struct.pack('<I4s',len(json_chunk),b'JSON')+json_chunk
    if bin_chunk:chunks+=struct.pack('<I4s',len(bin_chunk),b'BIN\0')+bin_chunk
    path.write_bytes(b'glTF'+struct.pack('<II',2,12+len(chunks))+chunks)
    return overrides


if __name__ == "__main__":
    main()
