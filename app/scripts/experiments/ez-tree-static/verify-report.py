"""Verify actual exported geometry/texture layout and record observed hashes."""
import copy, hashlib, json, math, struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent
manifest = json.loads((ROOT / 'cloud-manifest.json').read_text())
models = []
for expected in manifest['models']:
    path = ROOT / expected['file']
    raw = path.read_bytes()
    magic, version, total = struct.unpack_from('<4sII', raw)
    assert magic == b'glTF' and version == 2 and total == len(raw), path
    json_length, json_kind = struct.unpack_from('<I4s', raw, 12)
    assert json_kind == b'JSON'
    document = json.loads(raw[20:20 + json_length])
    binary_offset = 20 + json_length
    binary_length, binary_kind = struct.unpack_from('<I4s', raw, binary_offset)
    binary = raw[binary_offset + 8:]
    assert binary_kind == b'BIN\0' and binary_length == len(binary)
    for view in document['bufferViews']:
        assert view['byteOffset'] % 4 == 0 and view['byteOffset'] + view['byteLength'] <= len(binary)
    triangles = []
    ys = []
    for primitive in document['meshes'][0]['primitives']:
        positions = document['accessors'][primitive['attributes']['POSITION']]
        indices = document['accessors'][primitive['indices']]
        view = document['bufferViews'][positions['bufferView']]
        points = struct.unpack_from('<' + 'f' * positions['count'] * 3, binary, view['byteOffset'])
        assert all(math.isfinite(value) for value in points)
        ys.extend(points[1::3])
        index_view = document['bufferViews'][indices['bufferView']]
        code = 'H' if indices['componentType'] == 5123 else 'I'
        index_values = struct.unpack_from('<' + code * indices['count'], binary, index_view['byteOffset'])
        assert max(index_values) < positions['count'] and indices['count'] % 3 == 0
        triangles.append(indices['count'] // 3)
    assert triangles == [expected['triangles']['branches'], expected['triangles']['leaves']], path
    assert abs(max(ys) - min(ys) - 20) < 0.01, (path, min(ys), max(ys))
    assert document['materials'][1]['alphaMode'] == 'MASK' and document['materials'][1]['doubleSided']
    assert 'metallicRoughnessTexture' in document['materials'][0]['pbrMetallicRoughness']
    images = []
    for image in document['images']:
        view = document['bufferViews'][image['bufferView']]
        image_bytes = binary[view['byteOffset']:view['byteOffset'] + view['byteLength']]
        images.append({'name': image['name'], 'bytes': len(image_bytes), 'sha256': hashlib.sha256(image_bytes).hexdigest()})
    leaf = expected['preset'].split()[0].lower()
    assert images[-1]['sha256'] == manifest['textures']['leaf'][leaf]['sha256']
    for image, source in zip(images[:3], manifest['textures']['bark']['files']):
        assert image['sha256'] == source['sha256']
    # Correcting the cloud writer's nonstandard roughnessTexture key is the
    # only binary change. Reconstruct its original JSON and verify its raw SHA
    # independently, including every geometry/accessor and embedded image.
    old_document = copy.deepcopy(document)
    pbr = old_document['materials'][0]['pbrMetallicRoughness']
    pbr['roughnessTexture'] = pbr.pop('metallicRoughnessTexture')
    encoded = json.dumps(old_document, separators=(',', ':'), ensure_ascii=False).encode()
    encoded += b' ' * (-len(encoded) % 4)
    old_total = 12 + 8 + len(encoded) + 8 + len(binary)
    old_raw = b'glTF' + struct.pack('<II', 2, old_total) + struct.pack('<I4s', len(encoded), b'JSON') + encoded + struct.pack('<I4s', len(binary), b'BIN\0') + binary
    assert hashlib.sha256(old_raw).hexdigest() == expected['sha256'], f'Cloud geometry/content mismatch: {path}'
    models.append({'file': expected['file'], 'preset': expected['preset'], 'triangles': sum(triangles), 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(), 'heightMetres': max(ys) - min(ys), 'images': images, 'originalCloudContentVerified': True})

presets = {name: json.loads((ROOT / '.work/upstream/src/lib/presets' / name).read_text())['seed'] for name in manifest['generation']['presetFiles']}
report = {'sourceCommit': manifest['source']['commit'], 'presetSeeds': presets, 'heightPolicy': manifest['generation']['heightPolicy'], 'writerCorrection': 'Use the standard metallicRoughnessTexture field for the unchanged grayscale source roughness map. The reconstructed original cloud binary hash matches for all six outputs.', 'models': models, 'runtimeImported': False, 'visualAcceptance': False}
(ROOT / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
