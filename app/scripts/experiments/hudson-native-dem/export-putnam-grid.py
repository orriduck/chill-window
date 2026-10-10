#!/usr/bin/env python3
"""Cloud-only derived 2m grid from the already verified Putnam native crop."""
import argparse
import json
import math
from pathlib import Path

import numpy as np
from pyproj import CRS, Transformer

from source import bilinear, digest, now, require, write_json

BOUNDS = [-258, 6170, 188, 6670]  # minX, minZ, maxX, maxZ; inclusive vertices
ORIGIN = [-73.96, 41.36]
STEP, WIDTH, HEIGHT = 2, 224, 251
WORLD_SHA = 'c4a2eaea1d1ffc3d1f9c346dcceb812f10a4efb9755da146d4c18249002393ec'
WINDOW_SHA = '8f5d342c8c85aca4dbcb3f73e7984ba174bfe7552c5f0bb94b7b1074b2f1819a'
VALID_SHA = '662888a696821e13d5ab77f50c82c3e44664c567e176733c05987d07efbac937'
TILES = {
    '18TWL865855.tif': (9442572, 'fd4d7ac886f449f0d63acc44807fd33449fc8ee3f3397d0439fb53049a874bac'),
    '18TWL865840.tif': (9442570, '77735ad9350eddaf04f5977b499efdc78b310cc355f6e37073cc286e7e0fb51d'),
}


def unproject(x, z):
    """Exact GeoData.unproject formula; world XZ is not UTM easting/northing."""
    lon, lat = ORIGIN
    r, rad = 6378137., math.pi / 180
    k = math.cos(lat * rad)
    my = r * math.log(math.tan(math.pi / 4 + lat * rad / 2))
    return lon + x / (rad * r * k), (2 * math.atan(math.exp((z / k + my) / r)) - math.pi / 2) / rad


def main(args):
    diagnostic, scratch, out = Path(args.diagnostic), Path(args.scratch), Path(args.out)
    require(out.resolve() not in (diagnostic.resolve(), scratch.resolve()), 'Export directory must be separate from diagnostic/scratch')
    runtime_bytes = Path(args.runtime).read_bytes()
    runtime = json.loads(runtime_bytes)
    world_bytes = Path(args.world).read_bytes()
    require(digest(world_bytes) == runtime['sourceHashes']['world'] == WORLD_SHA, 'Exact world snapshot changed')
    require(json.loads(world_bytes)['origin'] == runtime['projection']['origin'] == ORIGIN, 'GeoData origin changed')
    meta_bytes = (diagnostic / 'native-metadata.json').read_bytes()
    meta = json.loads(meta_bytes)
    sources_bytes = (diagnostic / 'sources.json').read_bytes()
    sources = json.loads(sources_bytes)
    require(meta['sourceKind'] == sources['sourceKind'] == 'putnam2019', 'Wrong native source')
    require(meta['nativeGeotransform'] == [586500, 1, 0, 4587000, 0, -1]
            and meta['window'] == [149, 1102, 456, 510], 'Bounded native crop geometry changed')
    declarations = meta['sourceDatumDeclarations']
    require(declarations['acquisitionDates'] == ['20190423', '20190425']
            and declarations['vertical'] == 'North American Vertical Datum of 1988, Geoid 12B'
            and declarations['units'] == 'meters' and meta['verticalAdjustmentApplied'] is False,
            'Source dates, vertical units/datum or adjustment changed')
    require({t['filename'] for t in meta['tiles']} == set(TILES), 'Native tile set changed')
    source_tiles = []
    for name, (size, sha) in TILES.items():
        record = sources[name]
        tile = next(t for t in meta['tiles'] if t['filename'] == name)
        require(record['bodyBytes'] == size and record['completeBody'] is True
                and record['completeSourceSha256'] == tile['completeSourceSha256'] == sha,
                'Complete TIFF identity changed: ' + name)
        source_tiles.append({'file': name, 'url': record['url'], 'bytes': size, 'sha256': sha})
    horizontal = CRS.from_wkt(meta['decodedCrsWkt'])
    horizontal = horizontal.sub_crs_list[0] if horizontal.is_compound else horizontal
    require(horizontal.equals(CRS.from_epsg(6347), ignore_axis_order=True), 'Expected exact EPSG:6347 native horizontal CRS')
    pixels_path, valid_path = scratch / 'putnam-native-window.npy', scratch / 'putnam-native-valid.npy'
    pixels = np.load(pixels_path, allow_pickle=False)
    native_valid = np.load(valid_path, allow_pickle=False)
    require(pixels.shape == native_valid.shape == (510, 456)
            and pixels.dtype.str == '<f4' and native_valid.dtype == np.dtype(bool), 'Native array shape/encoding changed')
    require(digest(pixels.tobytes(order='C')) == meta['windowPixelSha256'] == WINDOW_SHA
            and digest(native_valid.tobytes(order='C')) == meta['windowValiditySha256'] == VALID_SHA,
            'Loaded decoded native bytes differ from verified metadata/snapshot')
    require(np.isfinite(pixels[native_valid]).all(), 'Native valid mask includes nonfinite heights')
    native = (pixels, native_valid, meta['nativeGeotransform'], 149, 1102,
              Transformer.from_crs('EPSG:4326', 'EPSG:6347', always_xy=True), meta)
    # Canonical quiet NaN bits remain in every invalid vertex; never zero-fill.
    elevation = np.full((HEIGHT, WIDTH), 0x7fc00000, dtype='<u4').view('<f4')
    valid = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    for row in range(HEIGHT):
        z = BOUNDS[1] + row * STEP
        for col in range(WIDTH):
            value = bilinear(*unproject(BOUNDS[0] + col * STEP, z), native)
            if value is not None and math.isfinite(value):
                elevation[row, col], valid[row, col] = value, 1
    out.mkdir(parents=True, exist_ok=True)
    outputs = {}
    for name, array in [('elevation.f32', elevation), ('valid.u8', valid)]:
        raw = array.tobytes(order='C')
        (out / name).write_bytes(raw)
        outputs[name] = {'bytes': len(raw), 'sha256': digest(raw)}
    count = int(valid.sum())
    manifest = {
        'schemaVersion': 1, 'createdAt': now(), 'sourceCommit': runtime['sourceCommit'],
        'runtimeImported': False, 'visualAcceptance': False, 'fixAccepted': False,
        'sourceKind': 'putnam2019', 'sourceAcquisitionDates': ['2019-04-23', '2019-04-25'],
        'horizontalSourceCRS': 'EPSG:6347', 'verticalDatum': 'NAVD88 / Geoid12B', 'verticalUnits': 'metres',
        'verticalAdjustmentApplied': False, 'sourceTiles': source_tiles,
        'worldSha256': WORLD_SHA, 'runtimeSnapshotSha256': digest(runtime_bytes),
        'nativeMetadataSha256': digest(meta_bytes), 'sourceRecordsSha256': digest(sources_bytes),
        'nativeWindow': {'window': meta['window'], 'geotransform': meta['nativeGeotransform'],
                         'firstPixelCentre': [586649.5, 4585897.5], 'pixelSha256': WINDOW_SHA,
                         'pixelBytes': pixels.nbytes, 'validitySha256': VALID_SHA,
                         'validityBytes': native_valid.nbytes, 'validPixelCount': int(native_valid.sum()),
                         'nodataPixelCount': int((~native_valid).sum()),
                         'npyFileSha256': digest(pixels_path.read_bytes()),
                         'validNpyFileSha256': digest(valid_path.read_bytes())},
        'origin': ORIGIN, 'bounds': BOUNDS, 'boundsOrder': ['minX', 'minZ', 'maxX', 'maxZ'],
        'stepMetres': STEP, 'width': WIDTH, 'height': HEIGHT, 'vertexCount': WIDTH * HEIGHT,
        'rowOrder': 'south-to-north (increasing world Z), west-to-east (increasing world X); row-major',
        'elevationEncoding': 'little-endian Float32 metres; invalid = canonical quiet NaN 0x7fc00000',
        'validityEncoding': 'uint8; 1 = all four native bilinear neighbours valid, 0 = invalid',
        'validCount': count, 'nodataCount': WIDTH * HEIGHT - count, 'allValid': count == WIDTH * HEIGHT,
        'sampling': 'Derived resampled 2m runtime grid, not raw 1m native data. Each world XZ vertex uses exact GeoData.unproject then EPSG:4326 to EPSG:6347 and source.bilinear at native pixel centres; four valid neighbours required.',
        'outputs': outputs, 'limits': ['2019 source is not contemporary ground truth', 'No runtime import or browser visual acceptance'],
    }
    write_json(out / 'manifest.json', manifest)
    require(sum(p.stat().st_size for p in out.iterdir() if p.is_file()) < 1_000_000, 'Export exceeds 1MB bound')
    if not manifest['allValid']:
        raise RuntimeError(f'Incomplete derived grid: {count}/{WIDTH * HEIGHT}; actual mask/NaN outputs preserved')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['runtime', 'world', 'diagnostic', 'scratch', 'out']:
        parser.add_argument('--' + name, required=True)
    main(parser.parse_args())
