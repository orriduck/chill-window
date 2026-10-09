#!/usr/bin/env python3
"""Acquire OSM stations/platforms and associate them with the retained FRA route.

Only standard-library dependencies. Cached raw responses and exact requests are
retained; --refresh performs a new acquisition. Geometry remains in WGS84.
The output supplies source geometry, not an invented station model or timetable.
"""
import argparse
import datetime
import gzip
import hashlib
import json
import math
from pathlib import Path
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1] / 'public/geodata/hudson'
QUERY = '''[out:json][timeout:60];
(
  nwr["railway"~"^(station|halt|platform|stop)$"](41.25,-74.08,41.46,-73.85);
  nwr["public_transport"="platform"]["train"="yes"](41.25,-74.08,41.46,-73.85);
  relation["public_transport"="stop_area"]["network"="Metro-North Railroad"](41.25,-74.08,41.46,-73.85);
);
out body geom;
'''
ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
MTA = 'https://www.mta.info/schedules/metro-north/hudson'
AMTRAK = 'https://content.amtrak.com/content/timetable/Empire%20Service.pdf'


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def acquire(refresh):
    sources = ROOT / 'sources'
    sources.mkdir(parents=True, exist_ok=True)
    raw_path = sources / 'overpass-stations.json.gz'
    request_path = sources / 'overpass-stations.request.json'
    query_hash = hashlib.sha256(QUERY.encode()).hexdigest()
    if not refresh and raw_path.exists() and request_path.exists():
        provenance = json.loads(request_path.read_text())
        raw = gzip.decompress(raw_path.read_bytes())
        if provenance['querySha256'] != query_hash or provenance['responseSha256'] != hashlib.sha256(raw).hexdigest():
            raise ValueError('Cached station source identity/checksum changed; use --refresh')
        expected = [endpoint + '?' + urllib.parse.urlencode({'data': QUERY}) for endpoint in ENDPOINTS]
        if provenance['url'] not in expected or provenance['method'] != 'GET':
            raise ValueError('Unexpected cached station source URL/method')
        return json.loads(raw), provenance
    errors = []
    for endpoint in ENDPOINTS:
        url = endpoint + '?' + urllib.parse.urlencode({'data': QUERY})
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'ChillWindow-GIS/1.0 (source-backed scenery)'})
            with urllib.request.urlopen(req, timeout=75) as response:
                raw = response.read()
            data = json.loads(raw)
            if data.get('remark') or not isinstance(data.get('elements'), list):
                raise ValueError(data.get('remark', 'Invalid OSM elements'))
            # The API must return way geometry; a centre-only response cannot
            # stand in for the true platform footprints.
            platforms = [e for e in data['elements'] if e['type'] == 'way' and e.get('tags', {}).get('railway') == 'platform']
            if not platforms or any(len(e.get('geometry', [])) < 2 for e in platforms):
                raise ValueError('Missing platform source geometry')
            provenance = {
                'url': url, 'method': 'GET', 'body': None,
                'fetchedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'responseSha256': hashlib.sha256(raw).hexdigest(), 'querySha256': query_hash,
                'osmBaseTimestamp': data.get('osm3s', {}).get('timestamp_osm_base'),
                'elements': len(data['elements']),
            }
            raw_path.write_bytes(gzip.compress(raw, mtime=0))
            write_json(request_path, provenance)
            (sources / 'overpass-stations.ql').write_text(QUERY)
            return data, provenance
        except Exception as error:
            errors.append(f'{endpoint}: {error}')
    raise RuntimeError('\n'.join(errors))


def build(data, provenance):
    world_path = ROOT / 'world.json'
    world = json.loads(world_path.read_text())
    origin = world['origin']
    radius, rad = 6378137.0, math.pi / 180
    scale = math.cos(origin[1] * rad)

    def project(point):
        lon, lat = point
        return ((lon - origin[0]) * rad * radius * scale,
                radius * math.log(math.tan(math.pi / 4 + lat * rad / 2) / math.tan(math.pi / 4 + origin[1] * rad / 2)) * scale)

    points = [project(p) for p in world['route']['points']]
    distances = [0.0]
    for a, b in zip(points, points[1:]):
        distances.append(distances[-1] + math.dist(a, b))

    def association(location):
        p = project(location)
        options = []
        for i, (a, b) in enumerate(zip(points, points[1:])):
            dx, dz = b[0] - a[0], b[1] - a[1]
            norm = dx * dx + dz * dz
            if norm == 0:
                continue
            raw_t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / norm
            t = min(1, max(0, raw_t))
            distance = math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t)
            options.append((distance, distances[i] + t * math.sqrt(norm), i, raw_t))
        distance, s, i, raw_t = min(options)
        within = distance <= 150 and not (i == 0 and raw_t < 0 or i == len(points) - 2 and raw_t > 1)
        return {'sMetres': round(s, 3), 'distanceToRouteMetres': round(distance, 3), 'inCurrentRoute': within}

    stations, features, relations = [], [], []
    for e in data['elements']:
        tags = e.get('tags', {})
        if tags.get('network') != 'Metro-North Railroad' and tags.get('train') != 'yes':
            continue  # unrelated bus stop_area relations stay in the raw snapshot
        identity = f'{e["type"]}/{e["id"]}'
        coordinates = [[p['lon'], p['lat']] for p in e.get('geometry', [])]
        if e['type'] == 'node':
            coordinates = [[e['lon'], e['lat']]]
        if e['type'] == 'relation':
            relations.append({'id': identity, 'tags': tags, 'members': e['members']})
            continue
        if not coordinates:
            raise ValueError(f'{identity}: no source geometry')
        for lon, lat in coordinates:
            if not (-74.08 <= lon <= -73.85 and 41.25 <= lat <= 41.46):
                raise ValueError(f'{identity}: source geometry beyond acquisition bounds')
        features.append({'id': identity, 'coordinates': coordinates, 'tags': tags})
        if tags.get('railway') in ['station', 'halt']:
            xs, ys = zip(*coordinates)
            location = [(min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2]
            stations.append({
                'id': identity, 'name': tags['name'], 'location': location,
                'locationMethod': 'osm_point' if e['type'] == 'node' else 'osm_area_bounds_center',
                'tags': tags, **association(location),
                'platformIds': [], 'platformAssociations': [], 'stopPositionIds': [], 'relationIds': [],
            })
    known = {f['id']: f for f in features}
    for station in stations:
        for relation in relations:
            if not any(f'{m["type"]}/{m["ref"]}' == station['id'] for m in relation['members']):
                continue
            station['relationIds'].append(relation['id'])
            for member in relation['members']:
                key = f'{member["type"]}/{member["ref"]}'
                f = known.get(key)
                if f and f['tags'].get('railway') == 'platform':
                    station['platformIds'].append(key)
                    station['platformAssociations'].append({'id': key, 'method': 'osm_stop_area_member', 'relationId': relation['id']})
                if f and f['tags'].get('public_transport') == 'stop_position':
                    station['stopPositionIds'].append(key)
        station['platformIds'] = sorted(set(station['platformIds']))
        station['stopPositionIds'] = sorted(set(station['stopPositionIds']))
        # Official Empire timetable lists Croton-Harmon and Poughkeepsie, with
        # none of these four intermediate Metro-North stations as Amtrak stops.
        station['empireServiceStopsHere'] = False
    claimed = {key for station in stations for key in station['platformIds']}
    for f in features:
        if f['id'] in claimed or f['tags'].get('railway') != 'platform' or any(key.startswith('disused:') for key in f['tags']):
            continue
        xs, ys = zip(*f['coordinates'])
        platform_point = project([(min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2])
        distance, _, station = min((math.dist(platform_point, project(s['location'])), s['id'], s) for s in stations)
        if distance <= 75:
            # OSM relations can lag behind new platform ways. Preserve the
            # geometrical association as an inference, never a fabricated member.
            station['platformIds'].append(f['id'])
            station['platformAssociations'].append({'id': f['id'], 'method': 'nearest_station_bounds_center', 'distanceMetres': round(distance, 3)})
    for station in stations:
        station['platformIds'] = sorted(set(station['platformIds']))
    stations.sort(key=lambda station: station['sMetres'])
    return {
        'schemaVersion': 1, 'bounds': world['bounds'], 'routeName': world['route']['name'],
        'routeLengthMetres': round(distances[-1], 3),
        'routeWorldSha256': hashlib.sha256(world_path.read_bytes()).hexdigest(),
        'source': {'name': 'OpenStreetMap', 'license': 'ODbL-1.0', **provenance},
        'serviceReferences': [
            {'url': MTA, 'verifiedAt': '2026-10-09', 'description': 'Hudson Line schedule effective October 4, 2026; station names and order'},
            {'url': AMTRAK, 'verifiedAt': '2026-10-09', 'description': 'Empire Service timetable for October 9, 2026; intermediate Metro-North stations are not Amtrak stops'},
        ],
        'limitations': ['No current departure times or service availability are inferred from OSM.',
                         'Station area marker is a bounds centre, not a surveyed station point.',
                         'Platform elevations, canopy geometry and materials are not supplied when absent in the source tags.',
                         'Any disused tags must be preserved and inspected before rendering a platform as active.'],
        'stations': stations, 'features': features, 'stopAreas': relations,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args()
    raw, source = acquire(args.refresh)
    result = build(raw, source)
    write_json(ROOT / 'stations.json', result)
    print(json.dumps({'stations': [{key: s[key] for key in ['name', 'sMetres', 'distanceToRouteMetres', 'inCurrentRoute', 'platformIds']} for s in result['stations']], 'features': len(result['features'])}, indent=2))
