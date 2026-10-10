#!/usr/bin/env python3
"""Bounded cloud diagnostic; nothing is imported into app runtime."""
import argparse
import csv
import itertools
import json
import math
from pathlib import Path
import traceback

import numpy as np

from source import acquire, bilinear, now, write_json, digest
from plots import maps, profiles


def statistics(values):
    a = np.asarray(values, dtype=float)
    return {'count': len(values), 'min': float(a.min()), 'median': float(np.median(a)), 'p95': float(np.percentile(a, 95)), 'max': float(a.max())} if len(a) else {'count': 0}


def unproject(runtime, x, z):
    lon, lat = runtime['projection']['origin']
    r, rad = 6378137., math.pi / 180
    k = math.cos(lat * rad)
    my = r * math.log(math.tan(math.pi / 4 + lat * rad / 2))
    return lon + x / (rad * r * k), (2 * math.atan(math.exp((z / k + my) / r)) - math.pi / 2) / rad


def main(args):
    out, scratch = Path(args.out), Path(args.scratch)
    out.mkdir(parents=True, exist_ok=True); scratch.mkdir(parents=True, exist_ok=True)
    runtime = json.loads(Path(args.runtime).read_text())
    native = acquire(runtime, out, scratch)
    for p in runtime['samples']:
        p['native1m'] = bilinear(p['longitude'], p['latitude'], native)
    series = ['native1m', 'raw20m', 'railBed', 'nearMesh']
    pairs = list(itertools.combinations(series, 2))
    delta_columns = [f'{a}-minus-{b}' for a, b in pairs]
    for p in runtime['samples']:
        for a, b in pairs:
            p[f'{a}-minus-{b}'] = p[a] - p[b] if p[a] is not None and p[b] is not None else None
    columns = ['s', 'offset', 'x', 'z', 'longitude', 'latitude', 'railHeight', 'eyeHeight', 'engineering', *series, *delta_columns]
    with (out / 'samples.csv').open('w', newline='') as file:
        writer = csv.DictWriter(file, fieldnames=columns)
        writer.writeheader(); writer.writerows({k: p[k] for k in columns} for p in runtime['samples'])
    common = [p for p in runtime['samples'] if all(p[k] is not None and math.isfinite(p[k]) for k in series)]
    deltas = {}
    for a, b in pairs:
        values = np.array([p[a] - p[b] for p in common])
        deltas[f'{a}-minus-{b}'] = {**statistics(values.tolist()), 'rmse': float(np.sqrt(np.mean(values ** 2))) if len(values) else None, 'maxAbsolute': float(np.max(np.abs(values))) if len(values) else None, 'medianAbsolute': float(np.median(np.abs(values))) if len(values) else None}
    offsets = []
    for pose in runtime['poses']:
        for distance in [4, 8, 12, 18, 20, 30]:
            for side in [-1, 1]:
                offset = distance * side
                p = next(p for p in runtime['samples'] if p['s'] == pose['s'] and p['offset'] == offset)
                row = {'s': pose['s'], 'side': 'right' if side > 0 else 'left', 'distance': distance, 'signedOffset': offset, **{k: p[k] for k in series}}
                # Native slope uses actual adjacent 1m locations, not a 20m-grid guess.
                neighbours = []
                for delta in [-1, 1]:
                    ll = unproject(runtime, pose['x'] + pose['right']['x'] * (offset + delta), pose['z'] + pose['right']['z'] * (offset + delta))
                    neighbours.append(bilinear(*ll, native))
                row['nativeSignedSlopeRisePerMetre'] = (neighbours[1] - neighbours[0]) / 2 if all(v is not None for v in neighbours) else None
                # Node includes actual ±1m neighbours for every requested offset at every pose.
                for key in series[1:]:
                    around = [next((p[key] for p in runtime['samples'] if p['s'] == pose['s'] and p['offset'] == offset + d), None) for d in [-1, 1]]
                    row[key + 'SignedSlopeRisePerMetre'] = (around[1] - around[0]) / 2 if all(v is not None for v in around) else None
                offsets.append(row)
    with (out / 'offset-heights-slopes.csv').open('w', newline='') as file:
        writer = csv.DictWriter(file, fieldnames=list(offsets[0])); writer.writeheader(); writer.writerows(offsets)
    imagery = Path(args.imagery)
    imagery_record = maps(runtime, native, imagery, out)
    profiles(runtime, out)
    write_json(out / 'naip-registration.json', imagery_record)
    at_eye = [p for p in runtime['samples'] if p['offset'] == 0]
    summary = {'createdAt': now(), 'sourceCommit': runtime['sourceCommit'], 'runtimeImported': False, 'visualAcceptance': False,
               'cloudCollectionSucceeded': True, 'notTerrainFixAcceptance': True, 'commonValidSamples': len(common), 'totalSamples': len(runtime['samples']),
               'nodataBySurface': {k: sum(p[k] is None for p in runtime['samples']) for k in series},
               'heightStatsCommonValid': {k: statistics([p[k] for p in common]) for k in series}, 'deltaStatsCommonValid': deltas,
               'routeToNearestOSMRailMetres': statistics([p['nearestOSMRails'][0]['distance'] for p in runtime['poses']]),
               'pose2790': next(p for p in runtime['poses'] if p['s'] == 2790),
               'eyeOverlapAtActualCameraXZ': [{**{k: p[k] for k in ['s', 'eyeHeight', 'railHeight', 'nearMesh']}, 'meshMinusEyeMetres': p['nearMesh'] - p['eyeHeight'] if p['nearMesh'] is not None else None, 'eyeUnderNearMesh': p['nearMesh'] >= p['eyeHeight'] if p['nearMesh'] is not None else None} for p in at_eye],
               'slopeConvention': 'signed lateral rise/metre towards positive right; central difference ±1m for every requested offset and every pose, for all four surfaces',
               'verticalDatumComparison': 'No vertical adjustment. Native XML declares NAVD88; vendor Geoid18. Existing prepared 20m datum realization not independently verified; scene rail profile is a visualization estimate, not survey.',
               'limits': ['Source maps require cloud artifact pixel inspection', 'No browser/gameplay visual inspection', 'Eye overlap only at actual route XZ; it does not test forward rays or prove absence of a slope in the window', 'No native TIFF imported into app', 'Network aggregate transfer bytes not measured']}
    write_json(out / 'summary.json', summary)
    # Keep native values in runtime samples for audit, with exact triangles from Node.
    write_json(out / 'runtime.json', runtime)
    (out / 'README.md').write_text(f'# Native DEM diagnostic collection\n\nCommit `{runtime["sourceCommit"]}`; collected {summary["createdAt"]}.\n\nCollection succeeded; runtimeImported=false; visualAcceptance=false.\nNative source, datum/date differences, range/fallback and unmeasured traffic are in sources.json/native-metadata.json.\nMap/profile PNGs require direct visual inspection. No application rendering or native terrain import occurred.\n')
    files = []
    for file in sorted(out.iterdir()):
        if file.is_file() and file.name != 'artifact-manifest.json':
            if file.suffix.lower() not in {'.png', '.csv', '.json', '.xml', '.md'}:
                raise RuntimeError('Forbidden output extension: ' + file.name)
            files.append({'path': file.name, 'bytes': file.stat().st_size, 'sha256': digest(file.read_bytes())})
    write_json(out / 'artifact-manifest.json', {'files': files, 'sourceTIFFUploaded': False, 'runtimeImported': False, 'visualAcceptance': False})


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--runtime', required=True); parser.add_argument('--out', required=True); parser.add_argument('--scratch', required=True)
    parser.add_argument('--imagery', default='app/public/geodata/hudson/imagery/corridor')
    args = parser.parse_args()
    try:
        main(args)
    except Exception as error:
        Path(args.out).mkdir(parents=True, exist_ok=True)
        write_json(Path(args.out) / 'failure.json', {'createdAt': now(), 'cloudCollectionSucceeded': False, 'runtimeImported': False, 'visualAcceptance': False, 'error': str(error), 'traceback': traceback.format_exc()})
        raise
