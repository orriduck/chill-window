"""Inspect actual embedded GLB outputs and source-keyed foliage accessor bytes."""
import hashlib, io, json, struct
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent

def inspect(path, expected_triangles):
    raw = path.read_bytes()
    magic, version, total = struct.unpack_from('<III', raw)
    assert magic == 0x46546C67 and version == 2 and total == len(raw)
    offset, doc, blob = 12, None, None
    while offset < len(raw):
        length, kind = struct.unpack_from('<II', raw, offset)
        chunk = raw[offset + 8:offset + 8 + length]
        if kind == 0x4E4F534A:
            doc = json.loads(chunk)
        elif kind == 0x004E4942:
            blob = chunk
        offset += 8 + length
    assert doc and blob and len(doc['buffers']) == 1
    assert 'uri' not in doc['buffers'][0]

    def accessor(index):
        item = doc['accessors'][index]
        assert 'sparse' not in item
        view = doc['bufferViews'][item['bufferView']]
        component_bytes = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}[item['componentType']]
        components = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT2': 4, 'MAT3': 9, 'MAT4': 16}[item['type']]
        element = component_bytes * components
        stride = view.get('byteStride', element)
        start = view.get('byteOffset', 0) + item.get('byteOffset', 0)
        assert start + (item['count'] - 1) * stride + element <= len(blob)
        packed = b''.join(blob[start + i * stride:start + i * stride + element] for i in range(item['count']))
        return {'count': item['count'], 'type': item['type'], 'componentType': item['componentType'], 'sha256': hashlib.sha256(packed).hexdigest()}

    records, triangles = {}, 0
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            assert primitive.get('mode', 4) == 4
            material = doc['materials'][primitive['material']]['name']
            record = {'attributes': {key: accessor(value) for key, value in sorted(primitive['attributes'].items())}, 'indices': accessor(primitive['indices']) if 'indices' in primitive else None}
            count = record['indices']['count'] if record['indices'] else record['attributes']['POSITION']['count']
            assert count % 3 == 0
            triangles += count // 3
            records.setdefault(material, []).append(record)
    assert triangles == expected_triangles, triangles
    leaves = sorted(records['pine_tree_01_twig'], key=lambda item: json.dumps(item, sort_keys=True, separators=(',', ':')))
    leaf_sha = hashlib.sha256(json.dumps(leaves, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    assert leaf_sha == '0ae502cc8ceb0ff51013367cfe9b983aaece6e0b9a073bd8850a7bf64f0aedd6', 'Foliage geometry changed'
    leaf = next(material for material in doc['materials'] if material['name'] == 'pine_tree_01_twig')
    # glTF 2.0 alphaCutoff defaults to 0.5 when the optional property is absent.
    assert leaf['alphaMode'] == 'MASK' and leaf.get('alphaCutoff', 0.5) == 0.5
    image_index = doc['textures'][leaf['pbrMetallicRoughness']['baseColorTexture']['index']]['source']
    images = []
    for index, image in enumerate(doc['images']):
        assert 'uri' not in image
        view = doc['bufferViews'][image['bufferView']]
        image_raw = blob[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']]
        decoded = Image.open(io.BytesIO(image_raw))
        if index == image_index:
            assert image['mimeType'] == 'image/png' and decoded.mode == 'RGBA'
            assert decoded.getchannel('A').getextrema() == (0, 255)
        images.append({'name': image.get('name'), 'bytes': len(image_raw), 'sha256': hashlib.sha256(image_raw).hexdigest(), 'dimensions': list(decoded.size)})
    return {'filename': path.name, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(), 'triangles': triangles, 'leafGeometrySha256': leaf_sha, 'images': sorted(images, key=lambda item: item['name'])}

outputs = [inspect(ROOT / 'pine_tree_01_a_LOD2-native.glb', 416451), inspect(ROOT / 'pine_tree_01_a_LOD2-branch50.glb', 381180)]
assert outputs[0]['images'] == outputs[1]['images'], 'Image content changed between variants'
(ROOT / 'actions-output-report.json').write_text(json.dumps({'outputs': outputs, 'visualInspection': 'pending; geometry equality is not browser visual acceptance'}, indent=2) + '\n')
print(json.dumps([{'filename': item['filename'], 'bytes': item['bytes'], 'sha256': item['sha256'], 'triangles': item['triangles']} for item in outputs], indent=2))
