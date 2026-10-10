#!/usr/bin/env python3
"""Read actual RGBA pixels and source bytes before publishing baked assets."""
import hashlib
import json
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent
manifest_path = root / 'impostors/tree-impostors.json'
manifest = json.loads(manifest_path.read_text())
assert manifest['source']['commit'] == 'dcf309bd86bd521083d9c70f01f2de45fdc7c457'
assert manifest['render']['blenderVersion'] == '4.0.2'
assert manifest['render']['resolutionPx'] == [512, 512]
assert manifest['render']['horizontalYawDegrees'] == list(range(0, 360, 45))
assert manifest['render']['sharedCameraBounds'] == {'worldWidthMetres': 22.0, 'worldHeightMetres': 22.0, 'worldBottomMetres': -0.5, 'worldTopMetres': 21.5}
report = {'manifestSha256': hashlib.sha256(manifest_path.read_bytes()).hexdigest(), 'blenderVersion': manifest['render']['blenderVersion'], 'frames': []}
for tree in manifest['trees']:
    expected_seed = {'Ash Large': 29919, 'Oak Large': 23399}[tree['preset']]
    assert tree['seed'] == expected_seed
    raw = root / tree['sourceRawGeometry']['file']
    assert hashlib.sha256(raw.read_bytes()).hexdigest() == tree['sourceRawGeometry']['sha256']
    assert raw.stat().st_size == tree['sourceRawGeometry']['bytes']
    assert [frame['yawDegrees'] for frame in tree['frames']] == list(range(0, 360, 45))
    for frame in tree['frames']:
        path = root / 'impostors' / frame['file']
        data = path.read_bytes()
        assert len(data) == frame['bytes']
        assert hashlib.sha256(data).hexdigest() == frame['sha256']
        image = Image.open(path)
        assert image.mode == 'RGBA' and image.size == (512, 512)
        alpha = image.getchannel('A')
        assert alpha.getextrema() == (0, 255)
        bbox = alpha.getbbox()
        assert bbox is not None and 0 < bbox[0] < bbox[2] < 512 and 0 < bbox[1] < bbox[3] < 512
        root_px = frame['rootPixelFromTopLeft']
        assert abs(root_px[0] - 256) < 0.001 and abs(root_px[1] - 500.3636) < 0.001
        assert abs(bbox[3] - root_px[1]) < 2
        projected = frame['projectedModelBoundsPixelExclusiveMax']
        assert all(0 < value < 512 for value in projected)
        report['frames'].append({'preset': tree['preset'], 'yawDegrees': frame['yawDegrees'], 'bytes': len(data), 'sha256': frame['sha256'], 'alphaBoundsPx': bbox, 'alphaExtrema': alpha.getextrema(), 'rootPixel': root_px})
assert len(report['frames']) == 16
(root / 'impostors/verified-report.json').write_text(json.dumps(report, indent=2) + '\n')
print(f'Verified {len(report["frames"])} real RGBA frames, source geometry bytes, roots and padding')
