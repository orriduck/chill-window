#!/usr/bin/env python3
"""Verify decoded source-object mesh bytes, not environment-specific GLB order.

The original cloud GLB and two Actions rebuilds have identical source-keyed
accessors/material names and embedded texture bytes despite different raw GLB
hashes. Preserve both hashes and independently gate that actual mesh content.
"""
import hashlib
import json
from prepare import ROOT, OUTPUT, read_glb

EXPECTED_RAW = {
    'd652fa8196efb62e0e4ca4d28daf6eda759a58c84ba2f0756f760731e7b04b69',
    '29a077b67cccd602c01eb6bd0de204cf6a20bebe9ff882af5238fe0ec11b79af',
}
EXPECTED_MESH = 'a04a18fad2b7eaee14659d71bffaafde3f24ccbb00e5aca0b8d92db3ccdd2bb3'
raw, document, binary = read_glb(OUTPUT)
assert hashlib.sha256(raw).hexdigest() in EXPECTED_RAW, 'Previously unreviewed GLB binary'
widths = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
sizes = {5126: 4, 5125: 4, 5123: 2, 5121: 1}

def accessor(index):
    item = document['accessors'][index]
    view = document['bufferViews'][item['bufferView']]
    offset = view.get('byteOffset', 0) + item.get('byteOffset', 0)
    width = widths[item['type']] * sizes[item['componentType']]
    stride = view.get('byteStride', width)
    values = b''.join(binary[offset+i*stride:offset+i*stride+width] for i in range(item['count']))
    assert len(values) == item['count'] * width
    return {'count': item['count'], 'type': item['type'], 'componentType': item['componentType'], 'sha256': hashlib.sha256(values).hexdigest()}

records = []
for node in document['nodes']:
    osm_id = node.get('extras', {}).get('osmId')
    if not osm_id:
        continue
    parts = []
    for child in node['children']:
        for primitive in document['meshes'][document['nodes'][child]['mesh']]['primitives']:
            parts.append({'material': document['materials'][primitive['material']]['name'],
                          'attributes': {name: accessor(index) for name, index in primitive['attributes'].items()},
                          'indices': accessor(primitive['indices']) if 'indices' in primitive else None})
    records.append({'osmId': osm_id, 'parts': sorted(parts, key=lambda item: json.dumps(item, sort_keys=True))})
records.sort(key=lambda item: item['osmId'])
normalized = json.dumps(records, sort_keys=True, separators=(',', ':')).encode()
assert len(records) == 18 and len(normalized) == 22109
assert hashlib.sha256(normalized).hexdigest() == EXPECTED_MESH, 'Source-keyed vertex/normal/UV/index content changed'
assert document['buffers'][0].get('uri') is None
assert all('uri' not in image for image in document['images'])
report = {'rawSha256': hashlib.sha256(raw).hexdigest(), 'semanticMeshSha256': EXPECTED_MESH, 'semanticBytes': len(normalized), 'sourceObjects': len(records), 'primitives': sum(len(record['parts']) for record in records), 'rawByteReproducibleAcrossEnvironments': False}
(ROOT / 'output/semantic-verification.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
