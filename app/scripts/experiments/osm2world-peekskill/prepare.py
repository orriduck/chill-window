#!/usr/bin/env python3
"""Rebuild the checked-in Peekskill building-only OSM2World GLB.

The input XML is an archived Overpass response. This script filters it to real
building/building:part ways and their referenced nodes, then runs official
OSM2World 0.4.0. Nothing is procedurally added by this script.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import struct
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "input/peekskill-overpass.xml"
SUBSET = ROOT / "input/peekskill-buildings-only.osm"
OUTPUT = ROOT / "output/peekskill-buildings.glb"
MANIFEST = ROOT / "manifest.json"
OSM2WORLD_RELEASE = "0.4.0"
OSM2WORLD_ARCHIVE_SHA256 = "c05b37920d29c26710a06e30c170ca62e5e8ea653cccbbb3243dfc7e5d20b899"
OSM2WORLD_ARCHIVE_BYTES = 452089567


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def read_glb(path: Path):
    raw = path.read_bytes()
    if raw[:4] != b"glTF":
        raise ValueError("OSM2World output is not a GLB")
    length, = struct.unpack_from("<I", raw, 8)
    cursor = 12
    gltf = None
    binary = None
    while cursor < length:
        size, kind = struct.unpack_from("<I4s", raw, cursor)
        cursor += 8
        chunk = raw[cursor:cursor + size]
        cursor += size
        if kind == b"JSON":
            gltf = json.loads(chunk.rstrip(b" \t\r\n\0"))
        elif kind == b"BIN\0":
            binary = chunk
    if gltf is None:
        raise ValueError("GLB is missing its JSON chunk")
    return raw, gltf, binary


def simplify_source() -> tuple[ET.Element, list[ET.Element], list[ET.Element], list[ET.Element]]:
    source = ET.parse(SOURCE).getroot()
    ways = [element for element in source.findall("way") if any(
        tag.get("k") in ("building", "building:part") for tag in element.findall("tag")
    )]
    relations = [element for element in source.findall("relation") if any(
        tag.get("k") in ("building", "building:part") for tag in element.findall("tag")
    )]
    node_ids = {nd.get("ref") for way in ways for nd in way.findall("nd")}
    node_ids.update(member.get("ref") for relation in relations
                    for member in relation.findall("member") if member.get("type") == "node")
    nodes = [node for node in source.findall("node") if node.get("id") in node_ids]

    subset = ET.Element("osm", source.attrib)
    for metadata in source:
        if metadata.tag in ("note", "meta", "bounds"):
            subset.append(metadata)
    for node in nodes:
        subset.append(node)
    for element in ways + relations:
        subset.append(element)
    ET.ElementTree(subset).write(SUBSET, encoding="UTF-8", xml_declaration=True)
    return source, ways, relations, nodes


def analyze(source: ET.Element, ways: list[ET.Element], relations: list[ET.Element],
            retained_nodes: list[ET.Element], command: list[str]):
    raw, gltf, binary = read_glb(OUTPUT)
    triangles = 0
    vertices = set()
    bounds = [[float("inf")] * 3, [-float("inf")] * 3]
    for mesh in gltf.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            position_index = primitive["attributes"]["POSITION"]
            position = gltf["accessors"][position_index]
            vertices.add(position_index)
            for axis in range(3):
                bounds[0][axis] = min(bounds[0][axis], position["min"][axis])
                bounds[1][axis] = max(bounds[1][axis], position["max"][axis])
            if "indices" in primitive:
                triangles += gltf["accessors"][primitive["indices"]]["count"] // 3
            else:
                triangles += position["count"] // 3

    emitted = {}
    for node in gltf.get("nodes", []):
        osm_id = node.get("extras", {}).get("osmId")
        if not osm_id:
            continue
        ymin, ymax = float("inf"), -float("inf")
        for child_index in node.get("children", []):
            child = gltf["nodes"][child_index]
            if "mesh" not in child:
                continue
            for primitive in gltf["meshes"][child["mesh"]]["primitives"]:
                position = gltf["accessors"][primitive["attributes"]["POSITION"]]
                ymin = min(ymin, position["min"][1])
                ymax = max(ymax, position["max"][1])
        emitted[osm_id] = {"yMinMetres": round(ymin, 4), "yMaxMetres": round(ymax, 4)}

    records = []
    for element in ways + relations:
        tags = {tag.get("k"): tag.get("v") for tag in element.findall("tag")}
        osm_id = ("w" if element.tag == "way" else "r") + element.get("id", "")
        out = emitted.get(osm_id)
        records.append({
            "osmId": osm_id,
            "name": tags.get("name"),
            "building": tags.get("building"),
            "buildingPart": tags.get("building:part"),
            "sourceHeightTag": tags.get("height"),
            "sourceLevelsTag": tags.get("building:levels"),
            "sourceTags": tags,
            "heightStatus": "osm_tag" if tags.get("height") else (
                "levels_only" if tags.get("building:levels") else "missing_in_osm"
            ),
            "outputNodePresent": out is not None,
            "outputVerticalBoundsMetres": out,
            "verticalValueIsConverterOutput": bool(out and not tags.get("height") and not tags.get("building:levels")),
        })

    output_ids = set(emitted)
    expected_ids = {r["osmId"] for r in records}
    if output_ids != expected_ids:
        raise ValueError(f"GLB source IDs differ: missing={expected_ids-output_ids}, extra={output_ids-expected_ids}")

    images = []
    views = gltf.get("bufferViews", [])
    for image in gltf.get("images", []):
        view = views[image["bufferView"]]
        start = view.get("byteOffset", 0)
        data = binary[start:start + view["byteLength"]] if binary is not None else b""
        images.append({"mimeType": image.get("mimeType"), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})

    latitudes = [float(node.get("lat")) for node in retained_nodes]
    longitudes = [float(node.get("lon")) for node in retained_nodes]
    geographic_origin = {
        "longitude": round((min(longitudes) + max(longitudes)) / 2, 10),
        "latitude": round((min(latitudes) + max(latitudes)) / 2, 10),
        "derivation": "midpoint of min/max lon/lat of nodes retained by the building-only input",
    }
    missing = [r for r in records if r["heightStatus"] == "missing_in_osm"]
    defaults = sorted({r["outputVerticalBoundsMetres"]["yMaxMetres"] for r in missing if r["outputVerticalBoundsMetres"]})

    manifest = {
        "experiment": "Peekskill OSM2World building-only real-data sample",
        "createdOn": "2026-10-09",
        "software": {
            "name": "OSM2World",
            "version": OSM2WORLD_RELEASE,
            "releaseArchiveUrl": "https://osm2world.org/download/files/0.4.0/OSM2World-0.4.0-bin.zip",
            "releaseArchiveBytes": OSM2WORLD_ARCHIVE_BYTES,
            "releaseArchiveSha256": OSM2WORLD_ARCHIVE_SHA256,
            "license": "MIT",
            "source": "https://github.com/tordanik/OSM2World",
            "cliCommand": command,
            "cliVersionOutput": "OSM2World 0.4.0",
        },
        "input": {
            "query": "input/peekskill-overpass.ql",
            "querySha256": digest(ROOT / "input/peekskill-overpass.ql"),
            "overpassUrl": "https://overpass-api.de/api/interpreter",
            "osmSnapshot": "input/peekskill-overpass.xml",
            "osmSnapshotSha256": digest(SOURCE),
            "osmSnapshotBytes": SOURCE.stat().st_size,
            "osmApiBaseTimestamp": next((m.get("osm_base") for m in source.findall("meta")), None),
            "license": "OpenStreetMap ODbL 1.0; attribution required",
            "areaBboxSouthWestNorthEast": [41.2833, -73.9335, 41.2863, -73.9295],
            "retainedBuildingWays": len(ways),
            "retainedBuildingRelations": len(relations),
            "retainedReferencedNodes": len([n for n in source.findall("node") if n.get("id") in {nd.get("ref") for w in ways for nd in w.findall("nd")}]),
            "buildingObjectsWithHeightTag": sum(r["heightStatus"] == "osm_tag" for r in records),
            "buildingObjectsWithLevelsOnly": sum(r["heightStatus"] == "levels_only" for r in records),
            "buildingObjectsMissingHeightAndLevels": len(missing),
            "records": records,
        },
        "projectionAndElevation": {
            "coordinateSystem": "OSM2World local metric projection; GLB stores no global CRS transform",
            "originLonLat": geographic_origin,
            "axes": {"x": "east-positive, metres", "y": "up, metres", "z": "south-positive (north is negative), metres"},
            "elevationInput": "No DEM/terrain was provided. Ground is y=0; vertical extent comes from tagged heights or OSM2World defaults. OSM ele tags are retained in source XML but are not used as terrain elevation in this conversion.",
        },
        "defaults": {
            "observedNoHeightFeatureOutputTopMetres": defaults,
            "observedMissingHeightFeatureCountWithGeometry": sum(bool(r["outputVerticalBoundsMetres"]) for r in missing),
            "interpretation": "For this exact 0.4.0 conversion, all three source objects with neither height nor building:levels produced yMin=0 and yMax=7.5m. This is converter-generated geometry, not an OSM tag, survey, or measured height.",
            "shelterSemanticMismatch": "OSM ways 1307801003 and 1307801004 are amenity=shelter / shelter_type=public_transport with building=yes and no height. OSM2World emitted building geometry up to 7.5m; that does not validate enclosed walls or this height. Keep the source-aware open-shelter implementation as the truth baseline.",
        },
        "output": {
            "file": "output/peekskill-buildings.glb",
            "sha256": digest(OUTPUT),
            "bytes": len(raw),
            "generator": gltf.get("asset", {}).get("generator"),
            "meshCount": len(gltf.get("meshes", [])),
            "primitiveCount": sum(len(mesh.get("primitives", [])) for mesh in gltf.get("meshes", [])),
            "uniquePositionAccessors": len(vertices),
            "triangles": triangles,
            "materials": [m.get("name") for m in gltf.get("materials", [])],
            "textures": len(gltf.get("textures", [])),
            "embeddedImages": images,
            "sourceOsmIdsPreservedAsNodeExtras": sorted(output_ids),
            "boundsXYZMetres": {"min": bounds[0], "max": bounds[1]},
        },
        "styleAndTextures": {
            "style": "OSM2World 0.4.0 shipped standard.properties + shipped texture folder",
            "styleSource": "https://github.com/tordanik/OSM2World-default-style",
            "styleLicense": "CC0-1.0",
            "buildingMaterial": "Plaster002",
            "roofMaterial": "RoofingTiles010",
            "textureOrigin": "The style uses CC0Textures material directories; six JPEG images are embedded in the GLB. These generic style textures are not building-specific survey photos.",
        },
        "comparisonBoundary": "This is a converter-default contrast sample only. Use the checked-in source XML/tags and existing source-aware building geometry as the truth baseline. OSM2World's generated height, default roof, windows, generic materials, and shelter closure are not local measurements or source facts.",
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--osm2world", default=os.environ.get("OSM2WORLD_BIN"),
                        help="path to the official 0.4.0 launcher (or set OSM2WORLD_BIN)")
    parser.add_argument("--verify-only", action="store_true", help="regenerate manifest, do not rerun conversion")
    args = parser.parse_args()
    if not SOURCE.is_file():
        raise SystemExit(f"Missing archived OSM response: {SOURCE}")
    source, ways, relations, retained_nodes = simplify_source()
    if not args.verify_only:
        if not args.osm2world:
            raise SystemExit("Pass --osm2world /path/to/osm2world.sh or set OSM2WORLD_BIN")
        command = [args.osm2world, f"--input={SUBSET}", f"--output={OUTPUT}", "--lod=2"]
        result = subprocess.run(command, cwd=Path(args.osm2world).resolve().parent,
                                capture_output=True, text=True, check=False)
        log = result.stdout + result.stderr
        print(log, end="")
        # OSM2World 0.4.0 returned status 0 even on a known invalid-road sample.
        if result.returncode != 0 or "ERROR" in log or not OUTPUT.is_file():
            raise SystemExit(f"OSM2World conversion failed (exit {result.returncode})")
    if not OUTPUT.is_file():
        raise SystemExit(f"Missing conversion artifact: {OUTPUT}")
    command = ["osm2world.sh", "--input=input/peekskill-buildings-only.osm",
               "--output=output/peekskill-buildings.glb", "--lod=2"]
    manifest = analyze(source, ways, relations, retained_nodes, command)
    print(json.dumps({"output": str(OUTPUT), "sha256": manifest["output"]["sha256"],
                      "triangles": manifest["output"]["triangles"],
                      "missingHeightDefaults": manifest["defaults"]["observedNoHeightFeatureOutputTopMetres"]},
                     indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()

