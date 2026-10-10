#!/usr/bin/env python3
"""Validate an actual source-height batch and package its unchanged runtime assets.

Python standard library only; no conversion or geometry processing is performed.
The independent full-geometry audit must already have passed in the source batch.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import struct
import xml.etree.ElementTree as ET

REPO = Path(__file__).resolve().parents[4]
EXPECTED_TILES = 415
EXPECTED_BUILDINGS = 5853
ORIGIN_DERIVATION = "midpoint of lon/lat extrema of coordinates in this exact tile input"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path):
    return json.loads(path.read_text())


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode()


def verify_file(path, sha256, size):
    require(path.is_file(), f"Missing asset: {path.name}")
    require(path.stat().st_size == size, f"Size mismatch: {path.name}")
    require(digest(path) == sha256, f"SHA-256 mismatch: {path.name}")


def glb_json(path):
    # Only inspect the JSON header; full source geometry was checked by the audit.
    with path.open("rb") as stream:
        magic, version, length = struct.unpack("<4sII", stream.read(12))
        require(magic == b"glTF" and version == 2 and length == path.stat().st_size, f"Bad GLB: {path.name}")
        size, kind = struct.unpack("<II", stream.read(8))
        require(kind == 0x4E4F534A and size < length - 20, f"Bad GLB JSON: {path.name}")
        return json.loads(stream.read(size))


def validate_batch(source, world_path, overlay_path):
    plan = read_json(source / "reports/corridor-batch-plan.json")
    require(read_json(source / "conversion-plan.json") == {key: value for key, value in plan.items() if key != "aggregateValidation"}, "Conversion plans disagree")
    geometry = read_json(source / "reports/source-geometry-verification.json")
    log = read_json(source / "reports/converter-log-audit.json")
    require(geometry.get("passed") is True and geometry.get("errors") == [], "Source geometry audit did not pass")
    require(log.get("errors") == [], "Converter log audit contains errors")
    require(geometry["tiles"] == EXPECTED_TILES and geometry["buildings"] == EXPECTED_BUILDINGS, "Incomplete geometry audit")
    world_sha, overlay_sha = digest(world_path), digest(overlay_path)
    require(world_sha == plan["world"]["sha256"], "World differs from converter input")
    require(overlay_sha == plan["buildingOverlay"]["sha256"] == geometry["overlaySha256"], "Building overlay differs from converter/audit input")
    overlay = read_json(overlay_path)
    require(overlay["baseWorldSha256"] == world_sha, "Overlay is for another world")
    original = {feature["id"]: feature for feature in overlay["features"]}
    id_map = read_json(source / "reports/source-id-map.json")
    require(id_map["worldSha256"] == world_sha and id_map["buildingsOverlaySha256"] == overlay_sha, "Source ID map input mismatch")
    source_records = {r["sourceId"]: r for r in id_map["records"]}
    require(len(source_records) == len(id_map["records"]) == EXPECTED_BUILDINGS, "Duplicate or incomplete source ID map")
    open_roofs = {r["sourceId"] for r in geometry["openRoofs"]}
    aggregate = plan["aggregateValidation"]
    for key in ("sourceIDSetMismatchedTiles", "badOutputs", "badTextureReferences"):
        require(aggregate[key] == [], f"Batch validation failed: {key}")
    require(aggregate["tileCount"] == aggregate["completedTileCount"] == EXPECTED_TILES, "Incomplete conversion batch")
    require(aggregate["convertedSourceRecordCount"] == EXPECTED_BUILDINGS, "Incomplete source record batch")
    require(plan["selection"]["convertibleBuildingComponents"] == EXPECTED_BUILDINGS and plan["selection"]["convertible256mTiles"] == EXPECTED_TILES, "Selection count mismatch")
    conversions = {r["tileKey"]: r for r in plan["conversions"]}
    require(len(conversions) == EXPECTED_TILES and set(conversions) == set(plan["tileKeys"]), "Tile plan mismatch")
    manifests = sorted(source.glob("tile-*/manifest.json"))
    require(len(manifests) == EXPECTED_TILES, "Missing or extra tile manifests")
    tiles, textures, seen, statuses, copies = [], {}, set(), Counter(), []
    manifest_hashes = []
    for manifest_path in manifests:
        m = read_json(manifest_path)
        name = manifest_path.parent.name
        require(re.fullmatch(r"tile--?\d+--?\d+", name), "Invalid tile directory")
        require(m["input"] == f"{name}/buildings.osm" and m["output"] == f"{name}/buildings.glb", "Unsafe or renamed tile path")
        require(m["tileKey"] in conversions, "Unplanned tile")
        conversion = conversions[m["tileKey"]]
        for key, value in conversion.items():
            require(m.get(key) == value, f"Tile manifest differs from plan: {name}/{key}")
        input_path, output_path = source / m["input"], source / m["output"]
        verify_file(input_path, m["inputSha256"], m["inputBytes"])
        verify_file(output_path, m["outputSha256"], m["outputBytes"])
        xml = ET.parse(input_path).getroot()
        nodes = xml.findall("node")
        require(bool(nodes), f"Empty input nodes: {name}")
        longitude = [float(n.attrib["lon"]) for n in nodes]
        latitude = [float(n.attrib["lat"]) for n in nodes]
        midpoint = [(min(longitude) + max(longitude)) / 2, (min(latitude) + max(latitude)) / 2]
        reported = m["converterInputOriginLonLat"]
        require(reported["derivation"] == ORIGIN_DERIVATION, f"Unknown converter origin selection: {name}")
        origin = [reported["longitude"], reported["latitude"]]
        require(all(math.isfinite(v) and abs(v - expected) < 1e-9 for v, expected in zip(origin, midpoint)), f"Converter origin differs from exact input: {name}")
        # This batch uses the converter's default local origin; reject overrides.
        require(len(m["command"]) == 4 and m["command"][3] == "--lod=2" and m["command"][1].startswith("--input=") and m["command"][2].startswith("--output="), f"Unexpected converter options: {name}")
        g = glb_json(output_path)
        actual_ids = [n["extras"]["osmId"] for n in g.get("nodes", []) if "osmId" in n.get("extras", {})]
        records = m["sourceRecords"]
        record_ids = [r["transportId"] for r in records]
        require(len(record_ids) == len(set(record_ids)) and len(actual_ids) == len(set(actual_ids)) and set(actual_ids) == set(record_ids), f"Missing, padded or duplicate GLB nodes: {name}")
        input_tags = {prefix + element.attrib["id"]: {t.attrib["k"]: t.attrib["v"] for t in element.findall("tag")} for kind, prefix in (("way", "w"), ("relation", "r")) for element in xml.findall(kind)}
        compact = []
        for record in records:
            source_id, transport_id = record["sourceId"], record["transportId"]
            require(source_id not in seen and source_id in source_records and source_id in original, f"Duplicate or unknown source: {source_id}")
            seen.add(source_id)
            height, status = record["heightMetres"], record["heightStatus"]
            require(status in ("source_tag", "source_estimate") and math.isfinite(height) and height > 0, f"No source height: {source_id}")
            source_height = original[source_id]["buildingHeight"]
            require(height == source_height["metres"] and status == source_height["status"], f"Height substitution: {source_id}")
            map_record = source_records[source_id]
            for key in ("transportId", "heightMetres", "heightStatus", "outputNodeBinding"):
                require(record[key] == map_record[key], f"Source map mismatch: {source_id}/{key}")
            require(map_record["tileKey"] == m["tileKey"] and record["outputNodeBinding"] == f"node_extras:{transport_id}", f"Source node binding mismatch: {source_id}")
            tags = input_tags[transport_id]
            require(tags["chill:source_id"] == source_id and tags["chill:height_status"] == status and abs(float(tags["height"]) - height) < 1e-7, f"Input source height mismatch: {source_id}")
            require(abs(m["analysis"]["nodeVerticalBoundsMetres"][transport_id]["yMaxMetres"] - height) < 0.001, f"Output source height mismatch: {source_id}")
            is_open = tags.get("building") == "roof"
            require(is_open == (source_id in open_roofs), f"Open roof audit mismatch: {source_id}")
            statuses[status] += 1
            compact.append({"sourceId": source_id, "transportId": transport_id, "heightMetres": height, "heightStatus": status, "openRoof": is_open})
        images = [image.get("uri") for image in g.get("images", [])]
        require(all(image.keys() == {"uri"} for image in g.get("images", [])), f"Embedded/unknown image payload: {name}")
        require(set(images) == {t["uri"] for t in m["textureFiles"]}, f"GLB texture reference mismatch: {name}")
        for texture in m["textureFiles"]:
            require(re.fullmatch(r"\.\./textures/[a-f0-9]{64}\.(jpg|png)", texture["uri"]), "Unsafe texture path")
            uri = texture["uri"][3:]
            require(Path(uri).stem == texture["sha256"], "Texture name is not content addressed")
            require(texture["mimeType"] == ("image/png" if uri.endswith(".png") else "image/jpeg"), "Texture MIME mismatch")
            entry = {"uri": uri, "sha256": texture["sha256"], "bytes": texture["bytes"], "mimeType": texture["mimeType"]}
            if uri in textures:
                require(textures[uri] == entry, "Conflicting texture manifests")
            else:
                verify_file(source / uri, entry["sha256"], entry["bytes"])
                textures[uri] = entry
                copies.append((source / uri, uri))
        compact.sort(key=lambda record: record["sourceId"])
        tiles.append({"uri": m["output"], "sha256": m["outputSha256"], "bytes": m["outputBytes"], "origin": origin, "records": compact})
        copies.append((output_path, m["output"]))
        manifest_hashes.append({"uri": f"{name}/manifest.json", "sha256": digest(manifest_path)})
    require(seen == set(source_records), "Source ID set differs from successful source batch")
    require(statuses == aggregate["heightStatusCounts"], "Source height counts differ from audit")
    require(len(textures) == aggregate["sharedTextureCount"] == 16, "Texture count differs from audit")
    require(sum(t["bytes"] for t in textures.values()) == aggregate["sharedTextureBytes"], "Texture bytes differ from audit")
    require(sum(t["bytes"] for t in tiles) == aggregate["finalTileGLBBytes"], "Model bytes differ from audit")
    catalog = {"schemaVersion": 1, "worldSha256": world_sha, "buildingsOverlaySha256": overlay_sha, "tiles": tiles, "textures": sorted(textures.values(), key=lambda texture: texture["uri"]), "totalBuildings": len(seen), "modelBytes": sum(t["bytes"] for t in tiles), "textureBytes": sum(t["bytes"] for t in textures.values()), "sourceTags": statuses["source_tag"], "sourceEstimates": statuses["source_estimate"], "openRoofs": len(open_roofs)}
    return catalog, copies, plan, manifest_hashes, overlay, read_json(world_path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Downloaded successful full-batch artifact directory")
    parser.add_argument("--world", type=Path, default=REPO / "app/public/geodata/hudson/world.json")
    parser.add_argument("--buildings", type=Path, default=REPO / "app/public/geodata/hudson/buildings.json")
    parser.add_argument("--output", type=Path, default=REPO / "app/public/models/osm2world/hudson")
    parser.add_argument("--records", type=Path, default=REPO / "app/src/engine/three/geography/GeoCorridorBuildingRecords.ts")
    parser.add_argument("--source-run", default="https://github.com/orriduck/chill-window/actions/runs/38045813068")
    parser.add_argument("--source-revision", default="e3b050c")
    parser.add_argument("--verify-only", action="store_true", help="Validate source and byte-identical existing package without writing")
    args = parser.parse_args()
    catalog, copies, plan, manifests, overlay, world = validate_batch(args.source, args.world, args.buildings)
    catalog_data = json_bytes(catalog)
    catalog_sha = hashlib.sha256(catalog_data).hexdigest()
    ids = sorted(record["sourceId"] for tile in catalog["tiles"] for record in tile["records"])
    records = ("// Generated by package-runtime.py from the verified source batch.\n"
               "export const corridorBuildingIds: readonly string[] = " + json.dumps(ids, indent=2) + ";\n"
               f"export const corridorBuildingCatalogSha256 = '{catalog_sha}';\n"
               "export const corridorBuildingCatalogUrl = '/models/osm2world/hudson/catalog.json';\n"
               f"export const corridorBuildingTotal = {len(ids)};\n").encode()
    provenance = {"schemaVersion": 1, "sourceRun": args.source_run, "sourceRevision": args.source_revision, "catalogSha256": catalog_sha, "converter": plan["osm2world"], "origin": {"order": ["longitude", "latitude"], "selection": ORIGIN_DERIVATION, "checkedAgainst": "Every exact checksum-verified input OSM node set", "projection": "OSM2World local metric Mercator, scaled by cosine of origin latitude; +X east, +Y up, +Z south"}, "sourceReports": [{"uri": f"reports/{name}", "sha256": digest(args.source / "reports" / name)} for name in ("corridor-batch-plan.json", "source-id-map.json", "source-geometry-verification.json", "converter-log-audit.json", "sample-validation.json")], "tileManifestSetSha256": hashlib.sha256(json_bytes(manifests)).hexdigest(), "selection": {key: value for key, value in plan["selection"].items() if key != "tileOriginRouteStartProjectedMetres"}, "validation": plan["aggregateValidation"], "sourceData": {"worldSha256": catalog["worldSha256"], "buildingsOverlaySha256": catalog["buildingsOverlaySha256"], "overtureRelease": overlay["release"], "overture": [{key: source[key] for key in ("type", "license", "fetchedAt", "responseSha256", "documentation", "stacIndexUrl", "partitions")} for source in overlay["sources"]], "openStreetMap": [source for source in world["sources"] if source["name"] == "OpenStreetMap contributors"]}, "limitations": ["Source-tag heights are source attributes; source estimates are upstream model estimates, not surveys.", "Roofing, plaster, windows and untagged details are OSM2World style proxies, not observed local appearance.", "Four open roofs have converter-derived thickness; missing-height footprints and excluded shelters remain outside this asset catalog.", "The source audit is full-batch geometry evidence, not browser visual acceptance."]}
    generated = {"catalog.json": catalog_data, "provenance.json": json_bytes(provenance), "source-geometry-verification.json": (args.source / "reports/source-geometry-verification.json").read_bytes(), "converter-log-audit.json": (args.source / "reports/converter-log-audit.json").read_bytes()}
    for uri, data in generated.items():
        require(b"/home/runner/" not in data, f"Runner path leaked to package: {uri}")
    if args.verify_only:
        for path, uri in copies:
            verify_file(args.output / uri, digest(path), path.stat().st_size)
        for uri, data in generated.items():
            require((args.output / uri).read_bytes() == data, f"Generated package differs: {uri}")
        require(args.records.read_bytes() == records, "Generated record module differs")
    else:
        # All source checks finish before copying any output. No GLB bytes/URIs change.
        for path, uri in copies:
            target = args.output / uri
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
        args.output.mkdir(parents=True, exist_ok=True)
        for uri, data in generated.items():
            (args.output / uri).write_bytes(data)
        args.records.parent.mkdir(parents=True, exist_ok=True)
        args.records.write_bytes(records)
    print(json.dumps({"catalogSha256": catalog_sha, "tiles": len(catalog["tiles"]), "textures": len(catalog["textures"]), **{key: catalog[key] for key in ("totalBuildings", "modelBytes", "textureBytes", "sourceTags", "sourceEstimates", "openRoofs")}, "verifiedExistingPackage": args.verify_only}, indent=2))


if __name__ == "__main__":
    main()
