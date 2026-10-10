#!/usr/bin/env python3
"""Independently compare actual GLB ground vertices/heights with source rings.

This verifies the rebuilt output directly, without requiring byte-identical
JSON serialization across Java environments. No geometry or tolerance changes
are made to the outputs. Full source-aware appearance acceptance is separate.
"""
import argparse, hashlib, json, math, struct
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
R = 6378137.0
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def mercator(lon, lat): return R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
def glb(path):
    raw = path.read_bytes()
    assert raw[:4] == b'glTF' and struct.unpack_from('<I', raw, 8)[0] == len(raw)
    cursor, document, binary = 12, None, b''
    while cursor < len(raw):
        length, kind = struct.unpack_from('<I4s', raw, cursor); cursor += 8
        chunk = raw[cursor:cursor+length]; cursor += length
        if kind == b'JSON': document = json.loads(chunk)
        elif kind == b'BIN\0': binary = chunk
    assert document is not None
    return document, binary
def positions(document, binary, index):
    accessor = document['accessors'][index]
    assert accessor['componentType'] == 5126 and accessor['type'] == 'VEC3'
    view = document['bufferViews'][accessor['bufferView']]
    offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    stride = view.get('byteStride', 12)
    for i in range(accessor['count']): yield struct.unpack_from('<3f', binary, offset + i * stride)
def boundary_distance(x, z, rings):
    error = float('inf')
    for ring in rings:
        for a, b in zip(ring, ring[1:] + ring[:1]):
            dx, dz = b[0]-a[0], b[1]-a[1]
            t = max(0, min(1, ((x-a[0])*dx+(z-a[1])*dz) / max(dx*dx+dz*dz, 1e-15)))
            error = min(error, math.hypot(x-a[0]-t*dx, z-a[1]-t*dz))
    return error

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--root', type=Path, required=True)
    ap.add_argument('--buildings', type=Path, default=REPO/'app/public/geodata/hudson/buildings.json')
    args = ap.parse_args()
    assert sha(args.buildings) == '0d5bd68c040b42f99138fbdb768167ef22e8c48b5442fe0bf7d889f7347bd54f'
    overlay = json.loads(args.buildings.read_text())
    features = {str(f['id']): f for f in overlay['features']}
    report = {'schemaVersion': 1, 'scope': 'Actual full-batch source height and structural footprint boundary comparison, including source polygon holes. Windows are converter appearance planes, reported separately; open roofs are not required to have walls to ground. Roof thickness/material details remain proxies.', 'overlaySha256': sha(args.buildings), 'tiles': 0, 'buildings': 0, 'groundVertices': 0, 'windowProxyGroundVertices': 0, 'maxWindowProxyBoundaryDistanceMetres': 0, 'openRoofs': [], 'maxBoundaryErrorMetres': 0, 'maxHeightErrorMetres': 0, 'errors': []}
    seen = set()
    for manifest_path in sorted(args.root.glob('tile-*/manifest.json')):
        manifest = json.loads(manifest_path.read_text())
        model = manifest_path.parent/'buildings.glb'
        assert sha(model) == manifest['outputSha256'] and model.stat().st_size == manifest['outputBytes']
        document, binary = glb(model)
        nodes = {str(node['extras']['osmId']): i for i, node in enumerate(document['nodes']) if node.get('extras', {}).get('osmId')}
        emitted = {record['transportId'] for record in manifest['sourceRecords']}
        assert set(nodes) == emitted
        origin = manifest['converterInputOriginLonLat']
        ox, oy = mercator(origin['longitude'], origin['latitude'])
        scale = math.cos(math.radians(origin['latitude']))
        for record in manifest['sourceRecords']:
            source = features[record['sourceId']]
            assert record['sourceId'] not in seen
            seen.add(record['sourceId'])
            assert source['buildingHeight']['status'] == record['heightStatus']
            assert record['heightStatus'] in ['source_tag', 'source_estimate']
            assert abs(source['buildingHeight']['metres'] - record['heightMetres']) < 1e-8
            assert source.get('tags', {}).get('amenity') != 'shelter'
            roof_only = source.get('tags', {}).get('building') == 'roof'
            rings = []
            for ring in [source['coordinates'], *source.get('holes', [])]:
                projected = []
                for lon, lat in ring:
                    mx, my = mercator(lon, lat); projected.append(((mx-ox)*scale, -(my-oy)*scale))
                rings.append(projected)
            stack = [nodes[record['transportId']]]
            low, high, ground = float('inf'), -float('inf'), 0
            roof_vertices = []
            while stack:
                node = document['nodes'][stack.pop()]
                # This exact converter emits baked coordinates. Refuse to
                # ignore an unexpected transform rather than hiding a mismatch.
                assert not any(key in node for key in ['matrix', 'translation', 'rotation', 'scale']), node.get('name')
                stack.extend(node.get('children', []))
                if 'mesh' not in node: continue
                for primitive in document['meshes'][node['mesh']]['primitives']:
                    material = document['materials'][primitive['material']]['name']
                    for x, y, z in positions(document, binary, primitive['attributes']['POSITION']):
                        low, high = min(low, y), max(high, y)
                        if roof_only: roof_vertices.append((x, y, z))
                        if abs(y) <= 1e-5:
                            error = boundary_distance(x, z, rings)
                            if material == 'Windows':
                                report['windowProxyGroundVertices'] += 1
                                report['maxWindowProxyBoundaryDistanceMetres'] = max(report['maxWindowProxyBoundaryDistanceMetres'], error)
                                continue
                            report['maxBoundaryErrorMetres'] = max(report['maxBoundaryErrorMetres'], error)
                            if error > 0.01: report['errors'].append({'sourceId': record['sourceId'], 'kind': 'ground_vertex_off_source_boundary', 'metres': error})
                            ground += 1
            height_error = abs(high-record['heightMetres'])
            report['maxHeightErrorMetres'] = max(report['maxHeightErrorMetres'], height_error)
            if roof_only:
                report['openRoofs'].append({'sourceId': record['sourceId'], 'minY': low, 'maxY': high, 'sourceHeight': record['heightMetres'], 'thicknessIsConverterProxy': True})
                for x, y, z in roof_vertices:
                    if abs(y-low) > 1e-5: continue
                    error = boundary_distance(x, z, rings)
                    report['maxBoundaryErrorMetres'] = max(report['maxBoundaryErrorMetres'], error)
                    if error > 0.01: report['errors'].append({'sourceId': record['sourceId'], 'kind': 'roof_edge_off_source_boundary', 'metres': error})
                base_failed = low <= 0 or ground != 0
            else:
                base_failed = abs(low) > 0.001 or not ground
            if base_failed or height_error > 0.001: report['errors'].append({'sourceId': record['sourceId'], 'kind': 'source_height_or_base_mismatch', 'low': low, 'high': high, 'height': record['heightMetres'], 'ground': ground})
            report['groundVertices'] += ground; report['buildings'] += 1
        report['tiles'] += 1
    assert report['tiles'] == 415 and report['buildings'] == 5853, report
    report['passed'] = not report['errors']
    path = args.root/'reports/source-geometry-verification.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k:v for k,v in report.items() if k != 'errors'}, indent=2))
    assert report['passed'], report['errors'][:10]

if __name__ == '__main__': main()
