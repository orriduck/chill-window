"""Cloud-only bounded source acquisition and unresampled native window."""
import hashlib
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError

import numpy as np
from osgeo import gdal
from pyproj import CRS, Transformer

TILE = 'https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/NY_SouthEast4County_A22/TIFF/USGS_1M_18_x58y459_NY_SouthEast4County_A22.tif'
EXPECTED_ID = '66f61812d34edb21c7294130'
EXPECTED_BYTES = 254726318
EXPECTED_PUBLICATION = '2024-09-25'
EXPECTED_TITLE = 'USGS 1 Meter 18 x58y459 NY_SouthEast4County_A22'
SOURCES = {
    'tnm.json': 'https://tnmaccess.nationalmap.gov/api/v1/products?datasets=Digital%20Elevation%20Model%20%28DEM%29%201%20meter&bbox=-73.962,41.416,-73.959,41.42&max=5',
    'sciencebase.json': 'https://www.sciencebase.gov/catalog/item/66f61812d34edb21c7294130?format=json',
    'product.xml': 'https://thor-f5.er.usgs.gov/ngtoc/metadata/waf/elevation/1_meter/geotiff/NY_SouthEast4County_A22/USGS_1M_18_x58y459_NY_SouthEast4County_A22.xml',
    'vendor.xml': 'https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/metadata/NY_SouthEast4County_A22/NY_SE4County_1_A22/reports/vendor_provided_xml/312022452_NYSDOP_Lidar_2022_DEM.xml',
}


class SemanticSourceError(ValueError):
    """Identity/metadata mismatch: never eligible for a TIFF download fallback."""


class RasterIOError(RuntimeError):
    """Only GDAL open/read failures are eligible for the bounded cloud fallback."""


def require(condition, message):
    if not condition:
        raise SemanticSourceError(message)


def xml_text(root, path):
    node = root.find(path)
    require(node is not None and node.text and node.text.strip(), 'Missing XML field: ' + path)
    return node.text.strip()


def verify_metadata(documents):
    tnm, science = documents['tnm.json'], documents['sciencebase.json']
    matches = [item for item in tnm.get('items', []) if item.get('sourceId') == EXPECTED_ID]
    require(len(matches) == 1, 'TNM must contain exactly one selected sourceId')
    item = matches[0]
    require(item.get('downloadURL') == TILE and item.get('urls', {}).get('TIFF') == TILE, 'TNM TIFF identity mismatch')
    require(item.get('publicationDate') == EXPECTED_PUBLICATION and item.get('sizeInBytes') == EXPECTED_BYTES, 'TNM publication/size mismatch')
    require(item.get('title') == EXPECTED_TITLE, 'TNM title mismatch')
    require(science.get('id') == EXPECTED_ID and science.get('title') == EXPECTED_TITLE, 'ScienceBase identity mismatch')
    dates = science.get('dates', [])
    publication = [d.get('dateString') for d in dates if d.get('type') == 'Publication']
    require(publication == [EXPECTED_PUBLICATION], 'ScienceBase publication mismatch')
    links = [link for link in science.get('webLinks', []) if link.get('type') == 'download' and link.get('uri') == TILE]
    require(len(links) == 1 and links[0].get('length') == EXPECTED_BYTES, 'ScienceBase TIFF/length mismatch')
    product, vendor = documents['product.xml'], documents['vendor.xml']
    product_dates = [xml_text(product, 'idinfo/timeperd/timeinfo/rngdates/' + name) for name in ['begdate', 'enddate']]
    vendor_dates = [xml_text(vendor, 'idinfo/timeperd/timeinfo/rngdates/' + name) for name in ['begdate', 'enddate']]
    require(product_dates == ['20220409', '20220430'], 'Product acquisition dates differ from selected record')
    require(vendor_dates == ['20220414', '20220430'], 'Vendor acquisition dates differ from selected record')
    require([d.get('dateString') for d in dates if d.get('type') == 'Start'] == ['2022-04-09']
            and [d.get('dateString') for d in dates if d.get('type') == 'End'] == ['2022-04-30'], 'ScienceBase acquisition dates mismatch')
    require(xml_text(product, 'idinfo/citation/citeinfo/pubdate') == '20240925', 'Product publication date mismatch')
    require(xml_text(product, 'idinfo/citation/citeinfo/title') == EXPECTED_TITLE, 'Product title mismatch')
    require(xml_text(product, 'distinfo/stdorder/digform/digtopt/onlinopt/computer/networka/networkr') == TILE, 'Product TIFF URL mismatch')
    product_horizontal = xml_text(product, 'spref/horizsys/planar/gridsys/gridsysn')
    require(product_horizontal == 'NAD83 / UTM zone 18N' and xml_text(product, 'spref/horizsys/planar/gridsys/utm/utmzone') == '18', 'Product horizontal datum/UTM mismatch')
    abstract = xml_text(product, 'idinfo/descript/abstract')
    vertical_match = re.search(r'elevation values are in (meters) and are referenced to the (North American Vertical Datum of 1988 \(NAVD88\))', abstract)
    require(vertical_match is not None, 'Product vertical datum/units missing or changed')
    product_units, product_vertical = vertical_match.groups()
    vendor_horizontal = xml_text(vendor, 'spref/horizsys/geodetic/horizdn')
    vendor_vertical = xml_text(vendor, 'spref/vertdef/altsys/altdatum')
    vendor_units = xml_text(vendor, 'spref/vertdef/altsys/altunits')
    require(vendor_horizontal == 'North American Datum of 1983 (2011)', 'Vendor horizontal datum mismatch')
    require(vendor_vertical == 'North American Vertical Datum of 1988, Geoid 18' and vendor_units == 'meters', 'Vendor vertical datum/units mismatch')
    require(xml_text(vendor, 'spref/horizsys/planar/gridsys/utm/utmzone') == '18', 'Vendor UTM zone mismatch')
    return {'selectedSourceId': item['sourceId'], 'selectedTIFF': item['downloadURL'], 'publicationDate': item['publicationDate'],
            'sourceDatumDeclarations': {'product': {'horizontal': product_horizontal, 'vertical': product_vertical, 'units': product_units, 'verticalDeclarationLocation': 'idinfo/descript/abstract', 'verticalDeclarationText': vertical_match.group(0)},
                                        'vendor': {'horizontal': vendor_horizontal, 'vertical': vendor_vertical, 'units': vendor_units}},
            'sourceAcquisitionDates': {'product': product_dates, 'vendor': vendor_dates},
            'observedDatesEncoding': 'YYYYMMDD XML text, independently checked against selected expected ranges; discrepancies preserved'}


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')


def identity(response, url):
    return {'url': url, 'resolvedUrl': response.url, 'checkedAt': now(),
            'status': response.status, 'reason': response.reason,
            'headers': dict(response.headers.items()),
            'responseHeadersAsText': response.headers.as_string(),
            'headerRepresentation': 'urllib parsed HTTP response headers, not raw wire/packet capture'}


def acquire(runtime, out, scratch):
    """No raster network traffic occurs until called by the cloud workflow."""
    gdal.UseExceptions()
    records, documents = {}, {}
    for filename, url in SOURCES.items():
        with urlopen(Request(url, headers={'User-Agent': 'chill-window-native-dem-diagnostic'}), timeout=120) as response:
            raw = response.read(8 * 1024 * 1024 + 1)
            if len(raw) > 8 * 1024 * 1024:
                raise RuntimeError('Small source response exceeded limit')
            records[filename] = {**identity(response, url), 'bytes': len(raw), 'sha256': digest(raw)}
        (out / filename).write_bytes(raw)
        if filename.endswith('.json'):
            try:
                documents[filename] = json.loads(raw)
            except (ValueError, TypeError) as error:
                raise SemanticSourceError('Invalid source JSON: ' + filename) from error
        else:
            try:
                xml = ET.fromstring(raw)
            except ET.ParseError as error:
                raise SemanticSourceError('Invalid source XML: ' + filename) from error
            for node in xml.iter():
                node.tag = node.tag.split('}')[-1]
            documents[filename] = xml
            # Preserve source-observed date/datum fields alongside the selected
            # product's declarations below; never silently reconcile differing dates.
            names = {'begdate', 'enddate', 'horizdn', 'altdatum', 'altunits', 'geoid', 'vertcsn', 'datum', 'datumn', 'utmzone'}
            records[filename]['observedMetadataFields'] = [
                {'tag': node.tag.split('}')[-1], 'text': node.text.strip()}
                for node in xml.iter() if node.tag.split('}')[-1].lower() in names and node.text and node.text.strip()]
        write_json(out / 'sources.json', records)
    try:
        declarations = verify_metadata(documents)
    except SemanticSourceError:
        raise
    except Exception as error:
        raise SemanticSourceError('Malformed source metadata structure: ' + str(error)) from error
    records['metadataVerification'] = declarations
    write_json(out / 'sources.json', records)
    with urlopen(Request(TILE, method='HEAD'), timeout=120) as response:
        records['tileHead'] = identity(response, TILE)
        write_json(out / 'sources.json', records)
        require(response.status == 200 and response.url == TILE, 'HEAD tile identity/status mismatch')
        require(response.headers.get('Content-Length') == str(EXPECTED_BYTES), 'HEAD tile length differs from fixed source identity')
    head_bytes = EXPECTED_BYTES
    head = records['tileHead']['headers']
    etag = next((v for k, v in head.items() if k.lower() == 'etag'), None)
    range_headers = {'Range': 'bytes=0-16383'}
    if etag:
        range_headers['If-Match'] = etag
    range_valid = False
    try:
        with urlopen(Request(TILE, headers=range_headers), timeout=120) as response:
            raw = response.read(16385)  # Never consume a server's unexpected full response.
            record = identity(response, TILE)
            crange = response.headers.get('Content-Range', '')
            record.update({'requestedRange': 'bytes=0-16383', 'bodyBytesRead': len(raw), 'sha256ReadBytes': digest(raw), 'valid206AndContentRange': range_valid})
            records['rangeProbe'] = record
            write_json(out / 'sources.json', records)
            require(response.url == TILE, 'Range tile identity mismatch')
            if response.status == 206:
                match = re.fullmatch(r'bytes 0-16383/(\d+)', crange)
                require(match is not None, '206 response has invalid Content-Range slice')
                require(int(match.group(1)) == head_bytes == EXPECTED_BYTES, 'Range total differs from HEAD/fixed source identity')
                require(len(raw) == 16384 and response.headers.get('Content-Length') == '16384', '206 response slice/body length mismatch')
                range_valid = True
                record['valid206AndContentRange'] = True
            else:
                require(response.status == 200, 'Unexpected non-206 range status')
    except SemanticSourceError:
        raise
    except (URLError, TimeoutError, OSError) as error:
        records['rangeProbe'] = {'checkedAt': now(), 'requestedRange': 'bytes=0-16383', 'valid206AndContentRange': False, 'error': str(error)}
    records.update({'networkBytes': 'notMeasured; no audited aggregate GDAL transfer counter', 'completeSourceSha256': None,
                    'runtimeImported': False, 'visualAcceptance': False})
    write_json(out / 'sources.json', records)
    gdal.SetConfigOption('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')
    gdal.SetConfigOption('CPL_VSIL_CURL_ALLOWED_EXTENSIONS', '.tif')
    gdal.SetConfigOption('GDAL_HTTP_TIMEOUT', '120')
    if etag:
        gdal.SetConfigOption('GDAL_HTTP_HEADERS', 'If-Match: ' + etag)

    def read_window(location):
        try:
            ds = gdal.Open(location, gdal.GA_ReadOnly)
        except RuntimeError as error:
            raise RasterIOError('GDAL open failed: ' + str(error)) from error
        if ds is None:
            raise RasterIOError('GDAL did not open candidate DEM')
        try:
            gt, projection = ds.GetGeoTransform(), ds.GetProjection()
        except RuntimeError as error:
            raise SemanticSourceError('Raster geotransform/projection unavailable') from error
        require(len(gt) == 6 and all(np.isfinite(v) for v in gt), 'Raster geotransform invalid')
        try:
            crs = CRS.from_wkt(projection)
            horizontal = crs.sub_crs_list[0] if crs.is_compound else crs
            approved = [(code, CRS.from_epsg(code)) for code in [6347, 26918]]
            compatible = [code for code, expected in approved if horizontal.equals(expected, ignore_axis_order=True)]
            require(compatible, 'Decoded raster CRS is not NAD83(2011) or product NAD83 / UTM18N')
            if crs.is_compound:
                require(len(crs.sub_crs_list) == 2 and crs.sub_crs_list[1].equals(CRS.from_epsg(5703), ignore_axis_order=True), 'Decoded vertical CRS is not NAVD88 height')
            transform = Transformer.from_crs('EPSG:4326', horizontal, always_xy=True)
        except SemanticSourceError:
            raise
        except Exception as error:
            raise SemanticSourceError('Raster CRS/Transformer semantics invalid: ' + str(error)) from error
        if not crs.is_projected or abs(gt[1] - 1) > 1e-6 or abs(gt[5] + 1) > 1e-6 or gt[2] != 0 or gt[4] != 0:
            raise SemanticSourceError('Expected unrotated native 1m projected DEM; refuse assumed resolution')
        if any(a.unit_name not in ('metre', 'meter') for a in crs.axis_info[:2]):
            raise SemanticSourceError('Native horizontal CRS is not in metres')
        require(ds.RasterXSize == 10012 and ds.RasterYSize == 10012 and ds.RasterCount == 1, 'Native raster dimensions/band count mismatch')
        ll = runtime['geographicCorners'] + [[p['longitude'], p['latitude']] for p in runtime['samples']]
        try:
            xy = np.array([transform.transform(*p, errcheck=True) for p in ll])
        except Exception as error:
            raise SemanticSourceError('Sample coordinate transformation failed') from error
        require(np.isfinite(xy).all(), 'Sample coordinates are not finite')
        cols, rows = (xy[:, 0] - gt[0]) / gt[1], (xy[:, 1] - gt[3]) / gt[5]
        c0, r0 = max(0, int(np.floor(cols.min())) - 3), max(0, int(np.floor(rows.min())) - 3)
        c1, r1 = min(ds.RasterXSize, int(np.ceil(cols.max())) + 3), min(ds.RasterYSize, int(np.ceil(rows.max())) + 3)
        if c1 <= c0 or r1 <= r0 or (c1 - c0) * (r1 - r0) > 2_000_000:
            raise SemanticSourceError('Native window empty or exceeds bounded diagnostic size')
        band = ds.GetRasterBand(1)
        try:
            pixels = band.ReadAsArray(c0, r0, c1 - c0, r1 - r0)
            mask = band.GetMaskBand().ReadAsArray(c0, r0, c1 - c0, r1 - r0)
        except RuntimeError as error:
            raise RasterIOError('GDAL native pixel/mask read failed: ' + str(error)) from error
        require(isinstance(pixels, np.ndarray) and pixels.shape == (r1-r0, c1-c0), 'Native pixel window shape mismatch')
        require(isinstance(mask, np.ndarray) and mask.shape == pixels.shape, 'Native nodata mask geometry mismatch')
        nodata = band.GetNoDataValue()
        require(nodata is None or isinstance(nodata, (float, int)), 'Native nodata is not numeric')
        valid = (mask != 0) & np.isfinite(pixels)
        if nodata is not None:
            valid &= pixels != nodata
        require(not np.any(valid & ((pixels < -500) | (pixels > 9000))), 'Native valid height range is not plausible metres')
        # Retain exact decoded native pixel window in runner scratch, without warping.
        np.save(scratch / 'native-window.npy', pixels, allow_pickle=False)
        np.save(scratch / 'native-valid.npy', valid, allow_pickle=False)
        meta = {'decodedCrsWkt': projection, 'decodedCrs': crs.to_string(), 'nativeGeotransform': list(gt),
                'dimensions': [ds.RasterXSize, ds.RasterYSize], 'window': [c0, r0, c1 - c0, r1 - r0],
                'nativePixelMetres': [gt[1], gt[5]], 'bandType': gdal.GetDataTypeName(band.DataType),
                'nodata': nodata if nodata is None or np.isfinite(nodata) else str(nodata),
                'blockSize': band.GetBlockSize(), 'imageStructure': ds.GetMetadata('IMAGE_STRUCTURE'),
                'layoutCOG': ds.GetMetadata('IMAGE_STRUCTURE').get('LAYOUT') == 'COG',
                'windowPixelSha256': digest(pixels.tobytes(order='C')), 'windowValiditySha256': digest(valid.tobytes(order='C')),
                'windowHashEncoding': f'row-major decoded {pixels.dtype.str}; boolean validity uint8; hashes are NOT full TIFF SHA',
                'validPixelCount': int(valid.sum()), 'nodataPixelCount': int((~valid).sum()),
                'sourceDatumDeclarations': declarations['sourceDatumDeclarations'],
                'sourceAcquisitionDates': declarations['sourceAcquisitionDates'],
                'observedDatesEncoding': declarations['observedDatesEncoding'],
                'decodedHorizontalCompatibleEPSG': compatible,
                'datumCompatibility': 'Only exact EPSG:6347 NAD83(2011)/UTM18N or EPSG:26918 product generic NAD83/UTM18N accepted; vendor and product declarations remain distinct',
                'dateCaveat': 'Metadata declarations differ; HTTP Last-Modified is not acquisition date',
                'accuracyCaveat': 'Vendor NVA 0cm is not accepted as zero error', 'verticalAdjustmentApplied': False}
        return pixels, valid, gt, c0, r0, transform, meta

    failure = 'Range response did not verify actual 206 and exact Content-Range'
    if range_valid:
        try:
            result = read_window('/vsicurl/' + TILE)
            records['readMode'] = 'vsicurl-native-window'
        except SemanticSourceError:
            # A semantic mismatch is not a reason to download 254MB again.
            raise
        except RasterIOError as error:
            failure = 'GDAL remote read failed: ' + str(error)
            result = None
    else:
        result = None
    if result is None:
        records['readMode'] = 'cloud-full-tile-fallback'
        records['fallbackReason'] = failure
        target = scratch / 'source.tif'
        h, size = hashlib.sha256(), 0
        headers = {'If-Match': etag} if etag else {}
        with urlopen(Request(TILE, headers=headers), timeout=180) as response, target.open('wb') as file:
            records['fullDownload'] = identity(response, TILE)
            require(response.status == 200 and response.url == TILE, 'Full tile HTTP identity/status mismatch')
            require(response.headers.get('Content-Length') == str(EXPECTED_BYTES), 'Full tile HTTP length mismatch')
            while True:
                data = response.read(1024 * 1024)
                if not data:
                    break
                size += len(data)
                if size > 350_000_000:
                    raise RuntimeError('Cloud full tile exceeded limit')
                h.update(data)
                file.write(data)
        require(size == head_bytes == EXPECTED_BYTES, 'Full tile differs from HEAD/fixed source size')
        records['completeSourceSha256'], records['fullSourceBytes'] = h.hexdigest(), size
        result = read_window(str(target))
    write_json(out / 'sources.json', records)
    write_json(out / 'native-metadata.json', result[-1])
    return result


def bilinear(lon, lat, native):
    pixels, valid, gt, c0, r0, transform, _ = native
    try:
        x, y = transform.transform(lon, lat, errcheck=True)
        require(np.isfinite(x) and np.isfinite(y), 'Bilinear sample transformed coordinate is not finite')
    except SemanticSourceError:
        raise
    except Exception as error:
        raise SemanticSourceError('Bilinear sample coordinate transformation failed') from error
    # GDAL affine describes pixel corners; bilinear sampling is at pixel centers.
    col, row = (x - gt[0]) / gt[1] - c0 - .5, (y - gt[3]) / gt[5] - r0 - .5
    c, r = int(np.floor(col)), int(np.floor(row))
    if c < 0 or r < 0 or c + 1 >= pixels.shape[1] or r + 1 >= pixels.shape[0] or not valid[r:r+2, c:c+2].all():
        return None
    tx, ty = col - c, row - r
    return float((pixels[r, c] * (1-tx) + pixels[r, c+1] * tx) * (1-ty)
                 + (pixels[r+1, c] * (1-tx) + pixels[r+1, c+1] * tx) * ty)
