"""Cloud-only two-tile Putnam 2019 DEM; native aligned crop, never a runtime import."""
import hashlib
import json
import xml.etree.ElementTree as ET
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import numpy as np
from osgeo import gdal
from pyproj import CRS, Transformer

from source import require, xml_text, identity, digest, write_json

XML_URL = 'https://gisdata.ny.gov/elevation/DEM/FEMA_2019_DEM/UTM18N_BLOCK01_DEM.xml'
XML_SHA = '323ae1b0c2b1298f35c438b3e16736d18f66ecfca8fd737b0b09610612eaa32f'
SERVICE_URL = 'https://elevation.its.ny.gov/arcgis/rest/services/FEMA_2019_1_meter/ImageServer?f=pjson'
INDEX_URL = 'https://elevation.its.ny.gov/arcgis/rest/services/Dem_Indexes/FeatureServer/2/query'
WINDOW = {'rings': [[[-73.96306599053142, 41.415404075535896], [-73.95776674182284, 41.415404075535896],
                     [-73.95776674182284, 41.41988453032237], [-73.96306599053142, 41.41988453032237],
                     [-73.96306599053142, 41.415404075535896]]], 'spatialReference': {'wkid': 4326}}
TILES = {
    '18TWL865855.tif': (19483, 9442572, '2ceef754885cae0560de15e53f3ce81c020e0c7ad33dc650a415ae0e3125ca00'),
    '18TWL865840.tif': (19223, 9442570, 'a06f2c65639d3a85aaf196aec286d75c939ca4f96e3723956f5b434278a7a34b'),
}
BASE_URL = 'https://gisdata.ny.gov/elevation/DEM/FEMA_2019_DEM/Putnam/'


def acquire(runtime, out, scratch):
    gdal.UseExceptions()
    records = {'sourceKind': 'putnam2019', 'runtimeImported': False, 'visualAcceptance': False,
               'fixAccepted': False, 'networkBytes': 'notMeasured; complete TIFF body sizes recorded separately'}

    def small(filename, url):
        with urlopen(Request(url, headers={'User-Agent': 'chill-putnam-dem-diagnostic'}), timeout=120) as response:
            raw = response.read(2_000_001)
            records[filename] = {**identity(response, url), 'bytes': len(raw), 'sha256': digest(raw)}
            require(response.status == 200 and response.url == url, 'Small source identity/status mismatch: ' + filename)
            require(len(raw) <= 2_000_000, 'Small source response exceeded bound')
        (out / filename).write_bytes(raw)
        write_json(out / 'sources.json', records)
        return raw

    raw = small('putnam-product.xml', XML_URL)
    require(len(raw) == 8466 and digest(raw) == XML_SHA, 'Selected Putnam XML identity changed')
    root = ET.fromstring(raw)
    dates = [xml_text(root, 'idinfo/timeperd/timeinfo/rngdates/' + name) for name in ['begdate', 'enddate']]
    require(dates == ['20190423', '20190425'], 'Putnam acquisition dates mismatch')
    horizontal = xml_text(root, 'spref/horizsys/geodetic/horizdn')
    vertical = xml_text(root, 'spref/vertdef/altsys/altdatum')
    units = xml_text(root, 'spref/vertdef/altsys/altunits')
    require(horizontal == 'North American Datum of 1983 (2011)' and xml_text(root, 'spref/horizsys/planar/gridsys/utm/utmzone') == '18', 'Putnam horizontal declaration mismatch')
    require(vertical == 'North American Vertical Datum of 1988, Geoid 12B' and units == 'meters', 'Putnam vertical declaration mismatch')
    abstract = xml_text(root, 'idinfo/descript/abstract')
    declarations = {'horizontal': horizontal, 'vertical': vertical, 'units': units,
                    'acquisitionDates': dates, 'abstract': abstract,
                    'geographicContradiction': 'First abstract sentence says Niagara; Geographic Extent says Westcheser and Putnam. Both preserved verbatim in XML.',
                    'metadataDimensions': [int(xml_text(root, 'spdoinfo/rastinfo/colcount')), int(xml_text(root, 'spdoinfo/rastinfo/rowcount'))],
                    'verticalAdjustmentApplied': False}
    service = json.loads(small('putnam-imageserver.json', SERVICE_URL))
    sr = service['spatialReference']
    require(service.get('name') == 'FEMA_2019_1_meter' and sr.get('latestWkid', sr.get('wkid')) == 6347
            and sr.get('latestVcsWkid', sr.get('vcsWkid')) == 5703, 'Putnam ImageServer CRS identity mismatch')
    require(service.get('bandCount') == 1 and service.get('pixelType') == 'F32'
            and abs(service['pixelSizeX'] - 1) < 1e-6 and abs(service['pixelSizeY'] - 1) < 1e-6, 'Putnam ImageServer native grid mismatch')
    params = {'f': 'pjson', 'geometryType': 'esriGeometryPolygon', 'inSR': '4326',
              'spatialRel': 'esriSpatialRelIntersects', 'outFields': '*', 'returnGeometry': 'true', 'outSR': '4326',
              'geometry': json.dumps(WINDOW, separators=(',', ':'))}
    write_json(out / 'putnam-index-query.json', {'endpoint': INDEX_URL, 'parameters': params, 'geometry': WINDOW,
                                              'dynamicResponseHashIsObservationOnly': True})
    index = json.loads(small('putnam-index.json', INDEX_URL + '?' + urlencode(params)))
    require('error' not in index and not index.get('exceededTransferLimit') and len(index.get('features', [])) == 2,
            'Putnam index must return exactly two complete selected features')
    require(index.get('spatialReference', {}).get('wkid') == 4326, 'Putnam index geometry CRS mismatch')
    features = {f['attributes']['FILENAME']: f for f in index['features']}
    require(set(features) == set(TILES), 'Putnam index returned different tiles')
    for name, (object_id, size, geometry_sha) in TILES.items():
        a, geometry = features[name]['attributes'], features[name]['geometry']
        require(a['OBJECTID'] == object_id and a['DIRECT_DL'] == BASE_URL + name and a['SIZE_'] == size
                and a['YEAR'] == '2019' and a['COLLECTION'] == 'FEMA - 2019', 'Putnam index tile identity mismatch: ' + name)
        require(digest(json.dumps(geometry, sort_keys=True, separators=(',', ':')).encode()) == geometry_sha,
                'Putnam tile index geometry changed: ' + name)
    def inside(lon, lat, ring):
        contained = False
        for a, b in zip(ring, ring[1:]):
            if (a[1] > lat) != (b[1] > lat) and lon < (b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0]:
                contained = not contained
        return contained
    indexed_counts = {name: sum(inside(p['longitude'], p['latitude'], features[name]['geometry']['rings'][0])
                               for p in runtime['samples']) for name in TILES}
    index_union = sum(any(inside(p['longitude'], p['latitude'], f['geometry']['rings'][0]) for f in features.values())
                      for p in runtime['samples'])
    records['indexedSampleCoverage'] = {'byTile': indexed_counts, 'union': index_union, 'total': len(runtime['samples']),
                                        'notNativeValidityEvidence': True}
    require(index_union == len(runtime['samples']), 'Official Putnam index union does not cover all requested samples')
    records['metadataVerification'] = declarations
    records['indexCaveat'] = 'TILE_DATE is not acquisition; PARTIAL=null and polygon coverage do not prove valid pixels.'
    write_json(out / 'sources.json', records)

    decoded = []
    for name, (_, size, _) in TILES.items():
        target, h, count = scratch / name, hashlib.sha256(), 0
        url = BASE_URL + name
        # Fixed complete-file fetches only; no GDAL remote reads or additional TIFFs.
        with urlopen(Request(url), timeout=180) as response, target.open('wb') as file:
            record = {**identity(response, url), 'expectedBytes': size}
            records[name] = record
            write_json(out / 'sources.json', records)
            require(response.status == 200 and response.url == url and response.headers.get('Content-Length') == str(size),
                    'Putnam TIFF HTTP identity/status/length mismatch: ' + name)
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                count += len(chunk)
                require(count <= size, 'Putnam TIFF exceeds fixed size')
                h.update(chunk); file.write(chunk)
        record.update({'bodyBytes': count, 'completeSourceSha256': h.hexdigest(), 'completeBody': count == size})
        write_json(out / 'sources.json', records)
        require(count == size, 'Putnam TIFF incomplete: ' + name)
        ds = gdal.Open(str(target), gdal.GA_ReadOnly)
        require(ds is not None and ds.RasterCount == 1, 'Putnam TIFF band count/open mismatch')
        gt, wkt = ds.GetGeoTransform(), ds.GetProjection()
        record['decodedRaster'] = {'dimensions': [ds.RasterXSize, ds.RasterYSize], 'bandCount': ds.RasterCount,
                                   'geotransform': list(gt), 'crsWkt': wkt}
        write_json(out / 'sources.json', records)
        require(len(gt) == 6 and np.isfinite(gt).all() and abs(gt[1] - 1) < 1e-6 and abs(gt[5] + 1) < 1e-6
                and gt[2] == 0 and gt[4] == 0, 'Putnam TIFF is not native unrotated 1m grid')
        crs = CRS.from_wkt(wkt)
        horizontal_crs = crs.sub_crs_list[0] if crs.is_compound else crs
        require(horizontal_crs.equals(CRS.from_epsg(6347), ignore_axis_order=True), 'Putnam decoded horizontal CRS mismatch')
        if crs.is_compound:
            require(len(crs.sub_crs_list) == 2 and crs.sub_crs_list[1].equals(CRS.from_epsg(5703), ignore_axis_order=True),
                    'Putnam decoded vertical CRS mismatch')
        require(all(a.unit_name in ('metre', 'meter') for a in horizontal_crs.axis_info), 'Putnam decoded horizontal units mismatch')
        band = ds.GetRasterBand(1)
        require(band.DataType == gdal.GDT_Float32 and band.GetScale() in (None, 1) and band.GetOffset() in (None, 0),
                'Putnam band must be unscaled Float32')
        unit = band.GetUnitType()
        require(unit.lower() in ('', 'm', 'meter', 'meters', 'metre', 'metres'), 'Putnam band unit contradicts XML metres')
        transform = Transformer.from_crs('EPSG:4326', horizontal_crs, always_xy=True)
        xy = np.array([transform.transform(*p, errcheck=True) for p in features[name]['geometry']['rings'][0]])
        extent = [gt[0], gt[3] + ds.RasterYSize * gt[5], gt[0] + ds.RasterXSize * gt[1], gt[3]]
        indexed_extent = [float(xy[:, 0].min()), float(xy[:, 1].min()), float(xy[:, 0].max()), float(xy[:, 1].max())]
        # Index corners are geographic approximations of 1500m tiles. Permit a
        # small native buffer, never silently accept a different spatial tile.
        differences = [float(a - b) for a, b in zip(extent, indexed_extent)]
        require(np.isfinite(xy).all() and max(abs(d) for d in differences) <= 20,
                'Putnam decoded extent differs materially from official index: ' + name)
        meta = {'filename': name, 'decodedCrsWkt': wkt, 'decodedCrs': crs.to_string(), 'nativeGeotransform': list(gt),
                'dimensions': [ds.RasterXSize, ds.RasterYSize], 'bandType': 'Float32', 'bandUnit': unit,
                'verticalUnitEvidence': 'XML metres; decoded band unit may be unspecified', 'scale': band.GetScale(), 'offset': band.GetOffset(),
                'extent': extent, 'indexedExtentProjected': indexed_extent, 'extentMinusIndexMetres': differences,
                'metadataDimensions': declarations['metadataDimensions'],
                'dimensionDifferenceFromMetadata': [ds.RasterXSize - declarations['metadataDimensions'][0], ds.RasterYSize - declarations['metadataDimensions'][1]],
                'acceptedExtentToleranceMetres': 20, 'completeSourceSha256': h.hexdigest()}
        decoded.append((ds, band, gt, crs, transform, meta))
        write_json(out / 'native-metadata.json', {'tiles': [d[-1] for d in decoded], 'sourceDatumDeclarations': declarations})

    base_gt, base_crs, transform = decoded[0][2:5]
    ll = runtime['geographicCorners'] + [[p['longitude'], p['latitude']] for p in runtime['samples']]
    xy = np.array([transform.transform(*p, errcheck=True) for p in ll])
    require(np.isfinite(xy).all(), 'Putnam sample projection nonfinite')
    cols, rows = (xy[:, 0] - base_gt[0]) / base_gt[1], (xy[:, 1] - base_gt[3]) / base_gt[5]
    c0, r0, c1, r1 = int(np.floor(cols.min())) - 3, int(np.floor(rows.min())) - 3, int(np.ceil(cols.max())) + 3, int(np.ceil(rows.max())) + 3
    require(0 < (c1-c0)*(r1-r0) <= 2_000_000 and c1 > c0 and r1 > r0, 'Putnam mosaic crop exceeds bound')
    pixels, valid = np.full((r1-r0, c1-c0), np.nan, dtype=np.float32), np.zeros((r1-r0, c1-c0), dtype=bool)
    for ds, band, gt, crs, _, meta in decoded:
        require(crs.equals(base_crs, ignore_axis_order=True), 'Putnam tiles have inconsistent CRS')
        dc, dr = (gt[0]-base_gt[0])/base_gt[1], (gt[3]-base_gt[3])/base_gt[5]
        require(abs(dc-round(dc)) < 1e-6 and abs(dr-round(dr)) < 1e-6
                and all(gt[i] == base_gt[i] for i in (1, 2, 4, 5)), 'Putnam tiles do not share an exact aligned native grid')
        dc, dr = round(dc), round(dr)
        tc0, tr0, tc1, tr1 = max(0, c0-dc), max(0, r0-dr), min(ds.RasterXSize, c1-dc), min(ds.RasterYSize, r1-dr)
        require(tc1 > tc0 and tr1 > tr0, 'Selected Putnam tile misses bounded crop')
        a = band.ReadAsArray(tc0, tr0, tc1-tc0, tr1-tr0)
        mask = band.GetMaskBand().ReadAsArray(tc0, tr0, tc1-tc0, tr1-tr0)
        require(isinstance(a, np.ndarray) and a.shape == (tr1-tr0, tc1-tc0) and mask.shape == a.shape, 'Putnam crop/mask shape mismatch')
        nodata = band.GetNoDataValue()
        good = (mask != 0) & np.isfinite(a)
        if nodata is not None:
            good &= a != nodata
        require(not np.any(good & ((a < -500) | (a > 9000))), 'Putnam valid values not plausible metres')
        dest = (slice(dr+tr0-r0, dr+tr1-r0), slice(dc+tc0-c0, dc+tc1-c0))
        existing, existing_valid = pixels[dest], valid[dest]
        overlap = existing_valid & good
        require(not np.any(overlap & (existing != a)), 'Putnam overlapping valid pixels disagree; no precedence or averaging')
        existing[good] = a[good]; existing_valid[good] = True
        meta.update({'cropWindow': [tc0, tr0, tc1-tc0, tr1-tr0], 'nodata': nodata if nodata is None or np.isfinite(nodata) else str(nodata),
                     'validCropPixels': int(good.sum()), 'overlappingValidPixels': int(overlap.sum()),
                     'decodedCropPixelSha256': digest(a.tobytes()), 'decodedCropValiditySha256': digest(good.tobytes())})
    np.save(scratch / 'putnam-native-window.npy', pixels, allow_pickle=False)
    np.save(scratch / 'putnam-native-valid.npy', valid, allow_pickle=False)
    meta = {'sourceKind': 'putnam2019', 'decodedCrsWkt': decoded[0][-1]['decodedCrsWkt'], 'nativeGeotransform': list(base_gt),
            'window': [c0, r0, c1-c0, r1-r0], 'nativePixelMetres': [base_gt[1], base_gt[5]],
            'tiles': [d[-1] for d in decoded], 'validPixelCount': int(valid.sum()), 'nodataPixelCount': int((~valid).sum()),
            'windowPixelSha256': digest(pixels.tobytes()), 'windowValiditySha256': digest(valid.tobytes()),
            'windowHashEncoding': 'row-major float32 mosaic and boolean uint8 validity; distinct from complete TIFF SHA',
            'sourceDatumDeclarations': declarations, 'verticalAdjustmentApplied': False,
            'mosaicMethod': 'Copy exact aligned native pixels into bounded crop; invalid gaps stay masked; conflicting valid overlap fails; no warp/resampling',
            'seamBounds': [d[-1]['extent'] for d in decoded]}
    write_json(out / 'native-metadata.json', meta)
    return pixels, valid, base_gt, c0, r0, transform, meta
