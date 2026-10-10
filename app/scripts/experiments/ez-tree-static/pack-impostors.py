#!/usr/bin/env python3
"""Losslessly pack the sixteen verified source frames; no image repainting."""
import hashlib
import json
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent
source = root / 'impostors'
out = source / 'runtime'
out.mkdir(exist_ok=True)
manifest_path = source / 'tree-impostors.json'
manifest = json.loads(manifest_path.read_text())
records = []
for tree in manifest['trees']:
    species = tree['preset'].split()[0].lower()
    atlas = Image.new('RGBA', (2048, 1024), (0, 0, 0, 0))
    frames = []
    for i, frame in enumerate(tree['frames']):
        assert frame['yawDegrees'] == i * 45
        path = source / frame['file']
        raw = path.read_bytes()
        assert hashlib.sha256(raw).hexdigest() == frame['sha256'] and len(raw) == frame['bytes']
        image = Image.open(path)
        assert image.mode == 'RGBA' and image.size == (512, 512)
        x, y = (i % 4) * 512, (i // 4) * 512
        atlas.paste(image, (x, y))
        frames.append({'yawDegrees': frame['yawDegrees'], 'sourcePngSha256': frame['sha256'],
            'sourcePixelSha256': hashlib.sha256(image.tobytes()).hexdigest(), 'rectPxFromTopLeft': [x, y, 512, 512],
            'rootPixelInFrame': frame['rootPixelFromTopLeft'], 'alphaBoundsInFrame': image.getchannel('A').getbbox()})
    path = out / f'{species}-8-view-atlas.png'
    atlas.save(path, compress_level=9)
    decoded = Image.open(path)
    for frame in frames:
        x, y, w, h = frame['rectPxFromTopLeft']
        assert hashlib.sha256(decoded.crop((x, y, x+w, y+h)).tobytes()).hexdigest() == frame['sourcePixelSha256']
    records.append({'species': species, 'image': {'file': path.name, 'bytes': path.stat().st_size,
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'pixelSha256': hashlib.sha256(decoded.tobytes()).hexdigest()},
        'sizePx': [2048, 1024], 'frames': frames})
result = {'schemaVersion': 1, 'sourceManifestSha256': hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
    'sourceCommit': manifest['source']['commit'], 'frameCount': 16,
    'sourceModelHeightMetres': 20, 'frameWorldBoundsMetres': [-11, -0.5, 11, 21.5],
    'sourceModelUnitsArePresentationOnly': True, 'sourcePixelsUnchanged': True,
    'sampling': {'framePx': 512, 'columns': 4, 'rows': 2, 'maxMipLevel': 8,
        'edgePolicy': 'power-of-two cells keep each mip reduction within its own frame through mip9; runtime clamps bilinear UVs to the selected mip texel centers and caps at mip8'},
    'atlases': records}
(out / 'tree-atlases.json').write_text(json.dumps(result, indent=2) + '\n')
print('Packed and read-back verified all 16 original RGBA frames')
print(json.dumps([record['image'] for record in records], indent=2))
