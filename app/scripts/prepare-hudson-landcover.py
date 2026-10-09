#!/usr/bin/env python3
"""Retain and decode the official 2025 Annual NLCD WMS classification map.

Requires Pillow. WCS returned a server error at acquisition time; this is a
categorical WMS sample, not the native COG. Exact RGB values from USGS user
guide v1.2 table 2-2 are decoded; unknown/blended colors stop acquisition.
GetFeatureInfo independently checks representative homogeneous source pixels.
Cached responses are checksum-bound to their requests; --refresh replaces them.
"""
import argparse
import collections
import datetime
import hashlib
import io
import json
import math
from pathlib import Path
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / 'public/geodata/hudson'
SERVICE = 'https://dmsdata.cr.usgs.gov/geoserver/mrlc_Land-Cover-Native_conus_year_data/wms'
LAYER = 'Land-Cover-Native_conus_year_data'
GUIDE = 'https://www.usgs.gov/centers/eros/science/annual-nlcd-science-user-product-guide'
PALETTE = {250: (0, 0, 0), 11: (70, 107, 159), 12: (209, 222, 248),
           21: (222, 197, 197), 22: (217, 146, 130), 23: (235, 0, 0), 24: (171, 0, 0),
           31: (179, 172, 159), 41: (104, 171, 95), 42: (28, 95, 44), 43: (181, 197, 143),
           52: (204, 184, 121), 71: (223, 223, 194), 81: (220, 217, 57), 82: (171, 108, 40),
           90: (184, 217, 235), 95: (108, 159, 184)}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def fetch(name, parameters, refresh):
    url = SERVICE + '?' + urllib.parse.urlencode(parameters)
    path = ROOT / 'sources' / name
    info_path = path.with_name(path.name + '.request.json')
    if path.exists() and info_path.exists() and not refresh:
        info = json.loads(info_path.read_text())
        data = path.read_bytes()
        if info['url'] != url or info['responseSha256'] != sha(data):
            raise RuntimeError('Source cache request/checksum mismatch: ' + name)
        return data, info
    request = urllib.request.Request(url, headers={'User-Agent': 'ChillWindow-GIS/1.0 (source-backed scenery)'})
    with urllib.request.urlopen(request, timeout=55) as response:
        data = response.read()
        content_type = response.headers.get('Content-Type')
    if name.endswith('.png') and not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise RuntimeError('NLCD map service did not return PNG: ' + data[:500].decode(errors='replace'))
    if name.endswith('.json'):
        value = json.loads(data)
        if value.get('error') or not value.get('features'):
            raise RuntimeError('NLCD source query failed')
    info = {'url': url, 'parameters': parameters, 'method': 'GET', 'contentType': content_type,
            'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
            'responseSha256': sha(data), 'responseBytes': len(data)}
    path.write_bytes(data)
    write_json(info_path, info)
    return data, info


def main():
    args = argparse.ArgumentParser()
    args.add_argument('--refresh', action='store_true')
    refresh = args.parse_args().refresh
    world_bytes = (ROOT / 'world.json').read_bytes()
    world = json.loads(world_bytes)
    capabilities, capabilities_info = fetch('annual-nlcd-2025-capabilities.xml',
        {'service': 'WMS', 'version': '1.3.0', 'request': 'GetCapabilities'}, refresh)
    time_values = [node.text or '' for node in ET.fromstring(capabilities).iter()
                   if node.tag.endswith('Dimension') and node.attrib.get('name') == 'time']
    if not any('2025-01-01T00:00:00.000Z' in values for values in time_values):
        raise RuntimeError('The source service does not declare the requested 2025 data')
    minx, minz, maxx, maxz = world['dem']['bounds']
    radius = 6378137
    lon, lat = world['origin']
    k = math.cos(math.radians(lat))
    x0 = radius * math.radians(lon)
    y0 = radius * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    bbox = [minx / k + x0, minz / k + y0, maxx / k + x0, maxz / k + y0]
    width, height = round((maxx - minx) / 30), round((maxz - minz) / 30)
    parameters = {'service': 'WMS', 'version': '1.1.1', 'request': 'GetMap', 'layers': LAYER,
                  'styles': '', 'srs': 'EPSG:3857', 'bbox': ','.join(map(str, bbox)),
                  'width': str(width), 'height': str(height), 'format': 'image/png',
                  'transparent': 'true', 'time': '2025-01-01T00:00:00.000Z'}
    raw, info = fetch('annual-nlcd-2025-map.png', parameters, refresh)
    image = Image.open(io.BytesIO(raw)).convert('RGBA')
    if image.size != (width, height):
        raise RuntimeError('NLCD map dimensions do not match the requested extent')
    decoder = {color: code for code, color in PALETTE.items()}
    pixels = list(image.get_flattened_data())
    classes = bytearray()
    for r, g, b, a in pixels:
        if a == 0:
            classes.append(250)
        elif a == 255 and (r, g, b) in decoder:
            classes.append(decoder[(r, g, b)])
        else:
            raise RuntimeError(f'Unrecognized / blended NLCD palette value {(r, g, b, a)}')
    counts = collections.Counter(classes)
    if sum(counts.values()) != width * height or counts[250] > width * height / 100:
        raise RuntimeError('NLCD coverage is incomplete')
    checks = []
    for code in [41, 11, 21, 22]:
        point = next(((x, y) for y in range(40, height - 40, 8) for x in range(40, width - 40, 8)
                      if all(classes[(y + dy) * width + x + dx] == code
                             for dx, dy in [(-4, 0), (4, 0), (0, -4), (0, 4), (0, 0)])), None)
        if point is None:
            raise RuntimeError(f'No homogeneous validation sample for expected class {code}')
        x, y = point
        query = {**parameters, 'request': 'GetFeatureInfo', 'query_layers': LAYER,
                 'info_format': 'application/json', 'feature_count': '1', 'x': str(x), 'y': str(y),
                 'i': str(x), 'j': str(y)}
        response, query_info = fetch(f'annual-nlcd-2025-check-{code}.json', query, refresh)
        observed = json.loads(response)['features'][0]['properties']['PALETTE_INDEX']
        if observed != code:
            raise RuntimeError(f'NLCD source class disagrees at {point}: expected {code}, got {observed}')
        checks.append({'class': code, 'pixel': [x, y], 'source': query_info})
    output = bytes(classes)
    snapshot = {'baseWorldSha256': sha(world_bytes), 'width': width, 'height': height,
                'bounds': [minx, minz, maxx, maxz], 'rowOrder': 'north-to-south',
                'resolution': [(maxx - minx) / width, (maxz - minz) / height], 'file': 'landcover.u8',
                'sha256': sha(output), 'noData': 250, 'year': 2025, 'collection': '1.2',
                'method': 'Exact USGS table 2-2 palette decoding of categorical WMS sample; not native COG',
                'sourceResolutionMetres': 30, 'source': info, 'capabilities': capabilities_info, 'paletteGuide': GUIDE,
                'classCounts': dict(sorted(counts.items())), 'pixelChecks': checks,
                'notice': 'Satellite classification is not an individual tree inventory. OSM polygons remain primary; forest classes 41/42/43 fill unmapped ground. Woody wetlands are not assumed to be mature forest.'}
    (ROOT / 'landcover.u8').write_bytes(output)
    write_json(ROOT / 'landcover.json', snapshot)
    print(json.dumps({'shape': [width, height], 'bytes': len(output), 'classes': dict(counts), 'sha256': sha(output)}))


if __name__ == '__main__':
    main()
