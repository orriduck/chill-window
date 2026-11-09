#!/usr/bin/env python3
"""Fetch an auditable Amtrak-only NTAD snapshot. Python standard library only."""
import argparse
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import urllib.parse
import urllib.request

SERVICE = 'https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_Amtrak_Routes/FeatureServer/0'
ROOT = Path(__file__).resolve().parent
PRECISION = 6  # ~0.11 m latitude, no simplification or path concatenation


def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_ids(expected, seen, count):
    if len(expected) != count or len(set(expected)) != count:
        raise ValueError('Count and reference object ID list disagree')
    if len(seen) != count or len(set(seen)) != count or set(seen) != set(expected):
        raise ValueError('Missing, duplicate, or unexpected IDs across pages')


def geodesic(a, b):
    """Vincenty inverse on WGS84, meters; fail rather than hide non-convergence."""
    if a == b:
        return 0.0
    major, flattening = 6378137.0, 1 / 298.257223563
    minor = (1 - flattening) * major
    u1, u2 = [math.atan((1-flattening)*math.tan(math.radians(p[1]))) for p in (a,b)]
    s1,c1,s2,c2 = math.sin(u1),math.cos(u1),math.sin(u2),math.cos(u2)
    lng = math.radians(b[0]-a[0]); lam = lng
    for _ in range(200):
        sl,cl = math.sin(lam),math.cos(lam)
        ss = math.hypot(c2*sl,c1*s2-s1*c2*cl)
        if ss == 0:
            return 0.0
        cs = s1*s2+c1*c2*cl
        sigma = math.atan2(ss,cs)
        sa = c1*c2*sl/ss
        ca2 = max(0.0,1-sa*sa)
        c2sm = cs-2*s1*s2/ca2 if ca2 > 1e-15 else 0.0
        c = flattening/16*ca2*(4+flattening*(4-3*ca2))
        nxt = lng+(1-c)*flattening*sa*(sigma+c*ss*(c2sm+c*cs*(-1+2*c2sm*c2sm)))
        if abs(nxt-lam) < 1e-12:
            break
        lam = nxt
    else:
        raise ValueError('WGS84 geodesic did not converge')
    usq = ca2*(major*major-minor*minor)/(minor*minor)
    aa = 1+usq/16384*(4096+usq*(-768+usq*(320-175*usq)))
    bb = usq/1024*(256+usq*(-128+usq*(74-47*usq)))
    ds = bb*ss*(c2sm+bb/4*(cs*(-1+2*c2sm*c2sm)-bb/6*c2sm*(-3+4*ss*ss)*(-3+4*c2sm*c2sm)))
    return minor*aa*(sigma-ds)


def component_count(paths):
    """Connected path groups by EXACT shared source vertices; no tolerance snapping."""
    parents = list(range(len(paths)))
    def find(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]; i = parents[i]
        return i
    vertices = {}
    for i,path in enumerate(paths):
        for point in path:
            key = tuple(point)
            if key in vertices:
                parents[find(i)] = find(vertices[key])
            else:
                vertices[key] = i
    return len({find(i) for i in range(len(paths))})


def ride_components(paths):
    """Maximal non-branching trails. Match exact SOURCE endpoints, never snap."""
    adjacency = {}
    for i,path in enumerate(paths):
        for endpoint in (path[0],path[-1]):
            adjacency.setdefault(tuple(endpoint),[]).append(i)
    used = set(); trails = []
    def walk(start, first):
        result = []; current = start; edge = first
        while edge not in used:
            used.add(edge)
            path = paths[edge]
            oriented = path if tuple(path[0]) == current else list(reversed(path))
            result.extend(oriented if not result else oriented[1:])
            current = tuple(oriented[-1])
            candidates = adjacency[current]
            if len(candidates) != 2:
                break
            remaining = [i for i in candidates if i not in used]
            if not remaining:
                break
            edge = remaining[0]
        trails.append(result)
    # Start at terminal / branching vertices before handling closed cycles.
    for endpoint,edges in adjacency.items():
        if len(edges) != 2:
            for edge in edges:
                if edge not in used:
                    walk(endpoint,edge)
    for i,path in enumerate(paths):
        if i not in used:
            walk(tuple(path[0]),i)
    return trails


def preview_line(points, tolerance=0.01):
    """RDP in lon/lat degrees ONLY for small map preview, not ride geometry."""
    keep = {0,len(points)-1}; stack = [(0,len(points)-1)]
    while stack:
        first,last = stack.pop(); a,b = points[first],points[last]
        dx,dy = b[0]-a[0],b[1]-a[1]; denom = dx*dx+dy*dy
        best,index = -1,None
        for i in range(first+1,last):
            q = points[i]
            t = max(0,min(1,((q[0]-a[0])*dx+(q[1]-a[1])*dy)/denom)) if denom else 0
            distance = (q[0]-a[0]-t*dx)**2+(q[1]-a[1]-t*dy)**2
            if distance > best:
                best,index = distance,i
        if index is not None and best > tolerance*tolerance:
            keep.add(index); stack.extend([(first,index),(index,last)])
    return [points[i] for i in sorted(keep)]


def edge_counts(paths):
    """Undirected edge multiset includes multiplicity, detects added gap edges."""
    from collections import Counter
    return Counter(tuple(sorted((tuple(a),tuple(b)))) for path in paths for a,b in zip(path,path[1:]))


def convert_feature(source):
    attrs = source['attributes']; oid = attrs['OBJECTID']
    route_id = f'ntad-amtrak-{oid}'
    raw_paths = source.get('geometry', {}).get('paths', [])
    if not raw_paths:
        raise ValueError(f'{route_id}: missing paths')
    paths = []
    for path in raw_paths:
        if len(path) < 2:
            raise ValueError(f'{route_id}: path has fewer than two points')
        result = []
        for p in path:
            if len(p) != 2 or not all(isinstance(v,(float,int)) and math.isfinite(v) for v in p):
                raise ValueError(f'{route_id}: invalid coordinate {p}')
            if not -180 <= p[0] <= 180 or not -90 <= p[1] <= 90:
                raise ValueError(f'{route_id}: coordinate outside WGS84 range')
            result.append([round(p[0],PRECISION),round(p[1],PRECISION)])
        paths.append(result)
    # Source vertices, not rounded vertices, determine connectivity.
    components = component_count(raw_paths)
    points = [p for path in paths for p in path]
    bounds = [min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points)]
    # Never sum the gap between the end of one path and the start of the next.
    length = sum(geodesic(a,b) for path in paths for a,b in zip(path,path[1:]))
    row = dict(routeId=route_id, name=attrs.get('name'), sourceObjectId=oid,
               bounds=bounds, geodesicLengthM=round(length,2), components=components,
               sourcePaths=len(paths), segments=sum(len(p)-1 for p in paths),
               vertices=len(points), routeUrl=attrs.get('ROUTE_URL'), file=f'routes/{route_id}.geojson')
    feature = {'type':'Feature','id':route_id,'bbox':bounds,'properties':dict(row),
               'geometry':{'type':'MultiLineString','coordinates':paths}}
    return feature,row


def fetch(path, params=None):
    url = SERVICE + path + '?' + urllib.parse.urlencode(params or {'f':'json'})
    with urllib.request.urlopen(url,timeout=120) as response:
        payload = response.read()
    data = json.loads(payload)
    if 'error' in data:
        raise RuntimeError(data['error'])
    return data, payload, url


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--offline',action='store_true',help='Rebuild from preserved raw snapshot')
    parser.add_argument('--page-size',type=int,default=10,help='Small default exercises pagination on 49-route layer')
    args = parser.parse_args()
    raw = ROOT/'raw'; raw.mkdir(exist_ok=True)
    if not args.offline:
        started = dt.datetime.now(dt.timezone.utc).isoformat()
        requests = []
        def capture(filename,path,params=None):
            data,payload,url = fetch(path,params)
            (raw/filename).write_bytes(payload)
            requests.append({'file':f'raw/{filename}','url':url,'sha256':sha(raw/filename)})
            return data
        layer = capture('layer.json','')
        cap = layer['maxRecordCount']
        if not layer['advancedQueryCapabilities']['supportsPagination']:
            raise ValueError('Layer no longer supports pagination')
        if not 1 <= args.page_size <= cap:
            raise ValueError('page size must be between 1 and maxRecordCount')
        count = capture('count-before.json','/query',{'where':'1=1','returnCountOnly':'true','f':'json'})['count']
        ids = capture('ids-before.json','/query',{'where':'1=1','returnIdsOnly':'true','f':'json'})['objectIds']
        features = []; pages = []
        for offset in range(0,count,args.page_size):
            filename = f'page-{offset:06d}.json'
            data = capture(filename,'/query',{'where':'1=1','outFields':'*','outSR':4326,
                'returnGeometry':'true','returnZ':'false','returnM':'false','orderByFields':'OBJECTID ASC',
                'resultOffset':offset,'resultRecordCount':args.page_size,'f':'json'})
            if data.get('spatialReference',{}).get('wkid') != 4326:
                raise ValueError('Unexpected coordinate reference system')
            batch = data['features']
            if len(batch) != min(args.page_size,count-offset):
                raise ValueError('Short page: possible transfer limit or concurrent mutation')
            features.extend(batch)
            pages.append({'file':f'raw/{filename}','offset':offset,'count':len(batch),
                          'exceededTransferLimit':data.get('exceededTransferLimit',False)})
        verify_ids(ids,[f['attributes']['OBJECTID'] for f in features],count)
        after_ids = capture('ids-after.json','/query',{'where':'1=1','returnIdsOnly':'true','f':'json'})['objectIds']
        after_count = capture('count-after.json','/query',{'where':'1=1','returnCountOnly':'true','f':'json'})['count']
        after_layer = capture('layer-after.json','')
        verify_ids(ids,after_ids,after_count)
        if after_layer.get('editingInfo') != layer.get('editingInfo'):
            raise ValueError('Service changed during fetch; rerun for a consistent snapshot')
        write_json(raw/'manifest.json',{'retrievedAt':started,'finishedAt':dt.datetime.now(dt.timezone.utc).isoformat(),
                    'featureCount':count,'pageSize':args.page_size,'pages':pages,'requests':requests})
    manifest = json.loads((raw/'manifest.json').read_text())
    for request in manifest['requests']:
        if sha(ROOT/request['file']) != request['sha256']:
            raise ValueError('Raw snapshot SHA mismatch: '+request['file'])
    layer = json.loads((raw/'layer.json').read_text())
    features = [feature for page in manifest['pages'] for feature in json.loads((ROOT/page['file']).read_text())['features']]
    ids = json.loads((raw/'ids-before.json').read_text())['objectIds']
    verify_ids(ids,[f['attributes']['OBJECTID'] for f in features],manifest['featureCount'])
    source = {'url':SERVICE,'retrievedAt':manifest['retrievedAt'],'datasetDescription':layer['description'],
        'lastEditUtc':dt.datetime.fromtimestamp(layer['editingInfo']['dataLastEditDate']/1000,dt.timezone.utc).isoformat(),
        'license':layer['copyrightText'],'copyright':layer['copyrightText'],'rawManifest':'raw/manifest.json','rawManifestSha256':sha(raw/'manifest.json')}
    rows = []
    for item in sorted(features,key=lambda f:f['attributes']['OBJECTID']):
        feature,row = convert_feature(item)
        feature['properties']['source'] = source['url']
        feature['properties']['sourceRetrievedAt'] = source['retrievedAt']
        write_json(ROOT/row['file'],feature)
        row['sha256'] = sha(ROOT/row['file']); row['bytes'] = (ROOT/row['file']).stat().st_size
        geo_file = row['file']
        raw_trails = ride_components(item['geometry']['paths'])
        trails = [[[round(v,PRECISION) for v in point] for point in trail] for trail in raw_trails]
        if edge_counts(trails) != edge_counts(feature['geometry']['coordinates']):
            raise ValueError('Ride trails introduced or dropped source edges')
        lengths = [round(sum(geodesic(a,b) for a,b in zip(trail,trail[1:])),2) for trail in trails]
        ride_file = f"rides/{row['routeId']}.json"
        default_index = max(range(len(lengths)),key=lambda i:lengths[i])
        ride = {'id':row['routeId'],'name':row['name'],'components':trails,
                'componentLengthsMetres':lengths,'defaultComponentIndex':default_index,
                'source':source}
        write_json(ROOT/ride_file,ride)
        row.update(id=row['routeId'],lengthMetres=row['geodesicLengthM'],componentCount=len(trails),
            connectedGroupCount=row['components'],defaultComponentIndex=default_index,
            geojsonFile=geo_file,geojsonSha256=row['sha256'],geojsonBytes=row['bytes'],
            file=ride_file,sha256=sha(ROOT/ride_file),bytes=(ROOT/ride_file).stat().st_size,
            preview=[preview_line(trail) for trail in trails])
        rows.append(row)
    catalog = {'schemaVersion':2,'coverage':'Amtrak passenger routes in this FRA/BTS NTAD snapshot only; not all US freight, commuter, regional or urban rail. Provider description of 50 states/DC is not proof of service in each state. Geometry includes Canadian portions; no US-boundary clipping.',
        'source':source,'coordinateSystem':'EPSG:4326 longitude,latitude','coordinateDecimals':PRECISION,
        'lengthMethod':'WGS84 ellipsoid Vincenty inverse, sum of consecutive vertices WITHIN each source path; shared alignments across routes are counted per route',
        'componentMethod':'componentCount counts ride trails: join only exact source endpoints at degree-2 vertices; split at gaps and branches; connectedGroupCount counts shared-source-vertex connectivity',
        'segmentDefinition':'Consecutive coordinate pairs inside source paths; sourcePaths counts the preserved ArcGIS paths',
        'routeIdPolicy':'ntad-amtrak-{OBJECTID}; source-layer identity, not guaranteed stable across future provider republishing',
        'routeCount':len(rows),'routes':rows}
    write_json(ROOT/'catalog.json',catalog)
    # Re-read outputs and compare their topology against every source path, point for point.
    for raw_feature,row in zip(sorted(features,key=lambda f:f['attributes']['OBJECTID']),rows):
        path = ROOT/row['geojsonFile']; output = json.loads(path.read_text())
        expected = [[[round(v,PRECISION) for v in p] for p in part] for part in raw_feature['geometry']['paths']]
        if output['geometry']['coordinates'] != expected or output['geometry']['type'] != 'MultiLineString':
            raise ValueError('Topology or source path ordering changed')
        if sha(path) != row['geojsonSha256']:
            raise ValueError('Output SHA mismatch')
        ride_path = ROOT/row['file']; ride = json.loads(ride_path.read_text())
        if sha(ride_path) != row['sha256'] or edge_counts(ride['components']) != edge_counts(expected):
            raise ValueError('Ride file/hash/topology mismatch')
        if len(ride['components']) != row['componentCount'] or not 0 <= ride['defaultComponentIndex'] < row['componentCount']:
            raise ValueError('Invalid ride component metadata')
    report = {'passed':True,'routes':len(rows),'pages':len(manifest['pages']),
        'sourcePaths':sum(r['sourcePaths'] for r in rows),'segments':sum(r['segments'] for r in rows),
        'vertices':sum(r['vertices'] for r in rows),'routeFileBytes':sum(r['bytes'] for r in rows),
        'rideComponents':sum(r['componentCount'] for r in rows),
        'geojsonFileBytes':sum(r['geojsonBytes'] for r in rows),
        'maxRideFileBytes':max(r['bytes'] for r in rows),
        'catalogBytes':(ROOT/'catalog.json').stat().st_size,'catalogSha256':sha(ROOT/'catalog.json'),
        'checks':['count vs before/after IDs','unique IDs across all pages','lastEdit unchanged during download',
                  'raw response SHA-256','finite WGS84 coordinates','all referenced route files and hashes',
                  'exact rounded source-path equality; no added gap edges','ride edge multiset equality and all ride file hashes']}
    write_json(ROOT/'validation.json',report)
    print(json.dumps(report,indent=2))

if __name__ == '__main__':
    main()
