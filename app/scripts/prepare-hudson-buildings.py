#!/usr/bin/env python3
"""Conflate retained OSM footprints with source-backed Overture building exports.

Dependencies: shapely>=2; --refresh additionally needs overturemaps==1.0.2.
The default uses retained exports and checks query identity/checksums. Output is
an optional building overlay; this does not silently overwrite world.json.
"""
import argparse
import collections
import copy
import datetime
import gzip
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import tempfile

from shapely.geometry import LineString, Polygon, shape
from shapely.ops import transform
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1] / 'public/geodata/hudson'
RELEASE = '2026-09-23.1'
BBOX = [-74.08, 41.25, -73.85, 41.46]
GUIDE = 'https://docs.overturemaps.org/guides/buildings/'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')


def retain_export(kind, path, partitions):
    raw = path.read_bytes()
    data = json.loads(raw)
    assert data['type'] == 'FeatureCollection'
    features = data['features']
    assert len({f['id'] for f in features}) == len(features), 'Duplicate GERS IDs'
    assert all(f['geometry']['type'] in ['Polygon', 'MultiPolygon'] for f in features)
    state = json.loads(Path(str(path) + '.state').read_text())
    assert state['last_release'] == RELEASE and state['type'] == kind
    assert list(state['bbox'].values()) == BBOX
    prefix = ROOT / 'sources' / f'overture-{kind}'
    prefix.parent.mkdir(parents=True, exist_ok=True)
    prefix.with_suffix('.geojson.gz').write_bytes(gzip.compress(raw, mtime=0))
    provenance = {
        'release': RELEASE, 'bbox': BBOX, 'type': kind, 'license': 'ODbL-1.0',
        'fetchedAt': state['last_run'], 'client': 'overturemaps',
        'clientVersion': importlib.metadata.version('overturemaps'),
        'responseSha256': sha(raw), 'responseBytes': len(raw), 'features': len(features),
        'stacIndexUrl': f'https://stac.overturemaps.org/{RELEASE}/collections.parquet',
        'partitions': ['s3://' + item for item in partitions],
        'command': ['overturemaps', 'download', '--bbox=' + ','.join(map(str, BBOX)),
                    '-f', 'geojson', '--type=' + kind, '-r', RELEASE,
                    '--connect_timeout', '10', '--request_timeout', '60', '-o', '<output.geojson>'],
        'description': 'Official client spatially filtered GeoParquet export; full source geometries and original properties preserved in GeoJSON.',
        'documentation': GUIDE,
    }
    save(prefix.with_suffix('.request.json'), provenance)


def refresh_exports():
    import overturemaps.core as client
    with tempfile.TemporaryDirectory(prefix='chill-overture-') as directory:
        for kind in ['building', 'building_part']:
            target = Path(directory) / f'{kind}.geojson'
            subprocess.run([sys.executable, '-m', 'overturemaps', 'download', '--bbox=' + ','.join(map(str, BBOX)),
                            '-f', 'geojson', '--type=' + kind, '-r', RELEASE,
                            '--connect_timeout', '10', '--request_timeout', '60', '-o', str(target)], check=True)
            partitions = client._get_files_from_stac('buildings', kind, client.BBox(*BBOX), RELEASE)
            if partitions is None:
                raise RuntimeError('Cannot retain exact STAC partition identities')
            retain_export(kind, target, partitions)


def load_export(kind):
    prefix = ROOT / 'sources' / f'overture-{kind}'
    provenance = json.loads(prefix.with_suffix('.request.json').read_text())
    raw = gzip.decompress(prefix.with_suffix('.geojson.gz').read_bytes())
    if provenance['release'] != RELEASE or provenance['bbox'] != BBOX or provenance['type'] != kind or provenance['responseSha256'] != sha(raw):
        raise ValueError(f'{kind}: source identity/checksum mismatch')
    result = json.loads(raw)
    if result['type'] != 'FeatureCollection' or len(result['features']) != provenance['features']:
        raise ValueError(f'{kind}: invalid source export')
    return result['features'], provenance


def source_for(props, attribute):
    records = props.get('sources', [])
    specific = [s for s in records if s.get('property') in [f'/properties/{attribute}', f'/{attribute}']]
    return specific or [s for s in records if not s.get('property')]


def height_descriptor(props):
    height = props.get('height')
    sources = source_for(props, 'height')
    if isinstance(height, (int, float)) and math.isfinite(height) and 0 < height < 900:
        estimated = any('ML' in s.get('dataset', '') for s in sources)
        return {'metres': height, 'status': 'source_estimate' if estimated else 'source_tag',
                'method': 'upstream_machine_learning' if estimated else 'upstream_height_attribute',
                'sourceDatasets': sorted({s['dataset'] for s in sources})}
    floors = props.get('num_floors')
    if isinstance(floors, (int, float)) and math.isfinite(floors) and 0 < floors < 290:
        return {'metres': None, 'status': 'floors_only', 'numFloors': floors,
                'method': 'upstream_floor_count', 'sourceDatasets': sorted({s['dataset'] for s in source_for(props, 'num_floors')})}
    return {'metres': None, 'status': 'missing', 'method': None, 'sources': []}


def original_height(tags):
    # Preserve explicit source tags; never replace a fresh OSM height with an
    # older estimated value. Strict units avoid silently interpreting feet as m.
    value = tags.get('height', '').strip()
    match = re.fullmatch(r'([0-9]+(?:\.[0-9]+)?)\s*(m|ft|\')?', value)
    if match:
        number = float(match[1]) * (0.3048 if match[2] in ['ft', "'"] else 1)
        if 0 < number < 900:
            return {'metres': number, 'status': 'source_tag', 'method': 'current_osm_height_tag', 'sources': [{'dataset': 'OpenStreetMap', 'property': 'height'}]}
    try:
        levels = float(tags.get('building:levels', ''))
        if math.isfinite(levels) and 0 < levels < 290:
            return {'metres': None, 'status': 'floors_only', 'numFloors': levels, 'method': 'current_osm_floor_count', 'sources': [{'dataset': 'OpenStreetMap', 'property': 'building:levels'}]}
    except ValueError:
        pass
    return {'metres': None, 'status': 'missing', 'method': None, 'sources': []}


def osm_ids(props):
    for record in props.get('sources', []):
        identity = record.get('record_id') or ''
        match = re.fullmatch(r'([wr])(\d+)(?:@\d+)?', identity)
        if record.get('dataset') == 'OpenStreetMap' and match:
            yield f'osm/{"way" if match[1] == "w" else "relation"}/{match[2]}'


def non_null(value):
    if isinstance(value, dict):
        return {key: non_null(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [non_null(item) for item in value]
    return value


def conflate():
    raw_world = (ROOT / 'world.json').read_bytes()
    world = json.loads(raw_world)
    upstream, upstream_request = load_export('building')
    parts, parts_request = load_export('building_part')
    origin = world['origin']
    radius, rad, scale = 6378137, math.pi / 180, math.cos(math.radians(origin[1]))
    y0 = radius * math.log(math.tan(math.pi / 4 + origin[1] * rad / 2))

    def project(lon, lat, z=None):
        return ((lon - origin[0]) * rad * radius * scale,
                (radius * math.log(math.tan(math.pi / 4 + lat * rad / 2)) - y0) * scale)

    features = copy.deepcopy([f for f in world['features'] if f['kind'] == 'building'])
    polygons = [transform(project, Polygon(f['coordinates'], f.get('holes', []))) for f in features]
    if not all(p.is_valid and p.area > 0 for p in polygons):
        raise ValueError('Invalid retained OSM footprint')
    tree = STRtree(polygons)
    indices = {f['id']: i for i, f in enumerate(features)}
    water = [transform(project, Polygon(f['coordinates'], f.get('holes', []))) for f in world['features'] if f['kind'] == 'water']
    water_tree = STRtree(water)
    route = transform(project, LineString(world['route']['points']))
    original_corridor = route.buffer(1200)
    wider_corridor = route.buffer(3000)
    for f in features:
        f['buildingHeight'] = original_height(f['tags'])
        f['provenance'] = {'geometry': {'dataset': 'OpenStreetMap', 'recordId': f['id']}, 'overtureMatches': []}
    stats = collections.Counter(originalOSM=len(features), upstream=len(upstream))
    issues, gers_to_output = [], {}
    for entry in upstream:
        polygon = transform(project, shape(entry['geometry']))
        props, gers = entry['properties'], entry['id']
        if not polygon.is_valid or polygon.is_empty:
            stats['invalidSourceGeometry'] += 1
            issues.append({'id': gers, 'reason': 'invalid_geometry'})
            continue
        candidates = set(int(i) for i in tree.query(polygon))
        candidates.update(indices[key] for key in osm_ids(props) if key in indices)
        matches, overlaps = [], []
        for i in candidates:
            intersection = polygon.intersection(polygons[i]).area
            if intersection <= 0:
                continue
            overlaps.append(i)
            iou = intersection / (polygon.area + polygons[i].area - intersection)
            if iou > 0.5:
                matches.append((iou, i))
        if matches:
            iou, i = max(matches)
            target = features[i]
            target['provenance']['overtureMatches'].append({'gersId': gers, 'iou': round(iou, 6), 'release': RELEASE})
            target['overtureProperties'] = non_null(props)
            gers_to_output[gers] = target['id']
            stats['matched'] += 1
            if target['buildingHeight']['metres'] is None:
                height = height_descriptor(props)
                if height['metres'] is not None:
                    target['buildingHeight'] = height
                    stats['heightEnriched'] += 1
            continue
        if overlaps:
            # Ambiguous intersections are recorded, never merged by guessing or
            # drawn as overlapping copies of a current OSM building.
            stats['ambiguousOverlapExcluded'] += 1
            issues.append({'id': gers, 'reason': 'overlap_without_iou_match', 'osmIds': [features[i]['id'] for i in overlaps]})
            continue
        centroid = polygon.centroid
        if any(water[int(i)].covers(centroid) for i in water_tree.query(centroid)):
            stats['waterExcluded'] += 1
            issues.append({'id': gers, 'reason': 'current_osm_water_centroid'})
            continue
        if props.get('is_underground'):
            stats['undergroundExcluded'] += 1
            issues.append({'id': gers, 'reason': 'underground'})
            continue
        geometry = shape(entry['geometry'])
        components = list(geometry.geoms) if geometry.geom_type == 'MultiPolygon' else [geometry]
        for index, component in enumerate(components):
            identity = f'overture/{gers}' + (f'/{index}' if len(components) > 1 else '')
            f = {'id': identity, 'kind': 'building',
                 'coordinates': [list(p) for p in component.exterior.coords],
                 'holes': [[list(p) for p in ring.coords] for ring in component.interiors],
                 'tags': {}, 'buildingHeight': height_descriptor(props), 'overtureProperties': non_null(props),
                 'provenance': {'geometry': {'dataset': 'Overture Maps', 'gersId': gers, 'release': RELEASE}, 'overtureMatches': []}}
            features.append(f)
            gers_to_output[gers] = identity
            stats['addedComponents'] += 1
            projected_component = transform(project, component)
            if projected_component.intersects(original_corridor):
                stats['addedComponentsWithin1200m'] += 1
            if projected_component.intersects(wider_corridor):
                stats['addedComponentsWithin3000m'] += 1
        stats['addedBuildings'] += 1
    building_parts = []
    for entry in parts:
        parent = entry['properties'].get('building_id')
        if parent not in gers_to_output:
            stats['unmatchedParts'] += 1
            continue
        building_parts.append({**entry, 'parentFeatureId': gers_to_output[parent], 'buildingHeight': height_descriptor(entry['properties'])})
    stats['outputComponents'] = len(features)
    stats['buildingParts'] = len(building_parts)
    stats['heightStatus'] = dict(collections.Counter(f['buildingHeight']['status'] for f in features))
    save(ROOT / 'buildings.json', {
        'schemaVersion': 1, 'release': RELEASE, 'bounds': BBOX, 'baseWorldSha256': sha(raw_world),
        'sources': [upstream_request, parts_request], 'stats': dict(stats),
        'method': 'Keep current OSM footprints/tags; enrich from Overture only at IoU>0.5; add non-overlapping full source footprints; preserve ambiguous intersections as exclusions.',
        'normalization': 'Null property fields are omitted; complete source records remain in retained GeoJSON exports. Attribute source records are stored once in overtureProperties.sources.',
        'limitations': ['OSM height tags are source attributes, not independently surveyed heights.',
                         'Microsoft ML heights are upstream estimates, not measurements.',
                         'Missing height/floor/roof/ facade information remains missing.',
                         'The output covers the entire regional bbox, unlike the original 1200m building corridor.'],
        'features': features, 'buildingParts': building_parts, 'exclusions': issues,
    })
    print(json.dumps(dict(stats), indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh', action='store_true')
    arguments = parser.parse_args()
    if arguments.refresh:
        refresh_exports()
    conflate()
