"""Cloud-only USGS point-cloud probe. Preserve real samples; invent no roof or height."""
import collections, hashlib, json, subprocess
from pathlib import Path
import laspy
import numpy as np
from pyproj import CRS, Transformer
from shapely.geometry import Polygon
from shapely import contains_xy

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'output'
OUT.mkdir(exist_ok=True)
selection = json.loads((ROOT / 'source-selection.json').read_text())
footprints = {item['osmId']: item for item in selection['sourceFootprints']}
report = {'sourceQuery': selection['query'], 'tiles': [], 'runtimeIntegration': 'none', 'roofMesh': 'not reconstructed; these are source observations only'}
for tile in selection['selectedTiles']:
    path = OUT / Path(tile['downloadURL']).name
    subprocess.run(['curl', '--fail', '--location', '--retry', '2', '--user-agent', 'ChillWindowDataProbe/1.0 (+https://github.com/orriduck/chill-window)', tile['downloadURL'], '--output', str(path)], check=True)
    assert path.stat().st_size == tile['sizeInBytes'], 'Source tile size differs from official catalogue'
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if 'observedSha256' in tile:
        assert digest == tile['observedSha256'], 'Source bytes differ from the first actual cloud probe'
    hist = collections.Counter()
    samples = {key: [] for key in tile['matches']}
    ground = {key: [] for key in tile['matches']}
    unclassified = {key: [] for key in tile['matches']}
    polygons = {key: Polygon(footprints[key]['coordinates']) for key in tile['matches']}
    with laspy.open(path) as reader:
        crs = reader.header.parse_crs()
        assert crs is not None, 'Missing source CRS; refuse guessed projection'
        horizontal = next((item for item in crs.sub_crs_list if item.is_projected), crs) if crs.is_compound else crs
        assert horizontal.is_projected
        transform = Transformer.from_crs(horizontal, CRS.from_epsg(4326), always_xy=True)
        metadata = {'title': tile['title'], 'catalogueId': tile['sourceId'], 'publicationDate': tile['publicationDate'], 'url': tile['downloadURL'], 'bytes': path.stat().st_size, 'sha256': digest, 'pointCount': reader.header.point_count, 'version': str(reader.header.version), 'pointFormat': reader.header.point_format.id, 'sourceCRSWKT': crs.to_wkt(), 'sourceAxes': [{'name': axis.name, 'unit': axis.unit_name, 'unitConversionFactor': axis.unit_conversion_factor} for axis in crs.axis_info], 'zScale': float(reader.header.scales[2]), 'sourceZUnits': 'Use the vertical source CRS/metadata; no guessed conversion', 'footprints': []}
        for points in reader.chunk_iterator(500000):
            classification = np.asarray(points.classification)
            hist.update({int(key): int(count) for key, count in zip(*np.unique(classification, return_counts=True))})
            keep = (classification == 6) | (classification == 2) | (classification == 1)
            if not np.any(keep):
                continue
            x, y, z = np.asarray(points.x)[keep], np.asarray(points.y)[keep], np.asarray(points.z)[keep]
            classes = classification[keep]
            returns = np.asarray(points.return_number)[keep]
            return_counts = np.asarray(points.number_of_returns)[keep]
            longitude, latitude = transform.transform(x, y)
            for key, polygon in polygons.items():
                inside = (classes == 6) & contains_xy(polygon, longitude, latitude)
                if np.any(inside):
                    samples[key].extend(np.column_stack([longitude[inside], latitude[inside], z[inside]]).tolist())
                unknown = (classes == 1) & contains_xy(polygon, longitude, latitude)
                if np.any(unknown):
                    unclassified[key].extend(np.column_stack([longitude[unknown], latitude[unknown], z[unknown], returns[unknown], return_counts[unknown]]).tolist())
                minx, miny, maxx, maxy = polygon.bounds
                # Ground observations within an explicit angular envelope,
                # excluding the source footprint; no inferred floor is applied.
                nearby = (classes == 2) & (longitude > minx - 0.00015) & (longitude < maxx + 0.00015) & (latitude > miny - 0.00012) & (latitude < maxy + 0.00012) & ~contains_xy(polygon, longitude, latitude)
                ground[key].extend(z[nearby].tolist())
    metadata['classificationCounts'] = dict(sorted(hist.items()))
    for key in tile['matches']:
        source = footprints[key]
        roof_points = samples[key]
        heights = [point[2] for point in roof_points]
        observed = {'osmId': key, 'name': source['name'], 'sourceOSMHeightTag': source['height'], 'sourceOSMBounds': source['bounds'], 'buildingClass6Points': len(roof_points), 'sourceZRange': [min(heights), max(heights)] if heights else None, 'nearbyGroundClass2Points': len(ground[key]), 'nearbyGroundSourceZQuantiles': np.quantile(ground[key], [0.1, 0.5, 0.9]).tolist() if ground[key] else None}
        metadata['footprints'].append(observed)
        unknown_points = unclassified[key]
        observed['unclassifiedInsideFootprintPoints'] = len(unknown_points)
        observed['unclassifiedSourceZQuantiles'] = np.quantile([point[2] for point in unknown_points], [0.1, 0.5, 0.9, 0.99]).tolist() if unknown_points else None
        (OUT / f'{key}-unclassified-footprint-points.json').write_text(json.dumps({'sourceTileSha256': digest, 'coordinates': 'WGS84 longitude/latitude; unchanged source z; return_number; number_of_returns', 'interpretation': 'Source classification 1, not classified roofs. OSM footprint clipping does not exclude trees or prove roof attribution.', 'record': observed, 'points': unknown_points}, separators=(',', ':')) + '\n')
        (OUT / f'{key}-source-roof-points.json').write_text(json.dumps({'sourceTileSha256': digest, 'coordinates': 'WGS84 longitude/latitude; z is unchanged source CRS value', 'record': observed, 'points': roof_points}, separators=(',', ':')) + '\n')
    report['tiles'].append(metadata)
(OUT / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps([{'title': tile['title'], 'sha256': tile['sha256'], 'classifications': tile['classificationCounts'], 'footprints': tile['footprints']} for tile in report['tiles']], indent=2))
