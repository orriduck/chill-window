"""Warp the real RGB crop to the renderer's Web Mercator axes, without colour edits."""
import hashlib, json, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'output'
source = OUT / 'peekskill-naip-2022-rgb-26918.tif'
target = OUT / 'peekskill-naip-2022-rgb-3857.tif'
png = OUT / 'peekskill-naip-2022-scene.png'
subprocess.run(['gdalwarp', '-overwrite', '-of', 'GTiff', '-t_srs', 'EPSG:3857', '-r', 'bilinear', '-co', 'COMPRESS=DEFLATE', str(source), str(target)], check=True)
subprocess.run(['gdal_translate', '-q', '-of', 'PNG', str(target), str(png)], check=True)
info = json.loads(subprocess.check_output(['gdalinfo', '-json', str(target)], text=True))
origin_x, dx, shear_x, origin_y, shear_y, dy = info['geoTransform']
assert dx > 0 and dy < 0 and shear_x == 0 and shear_y == 0
width, height = info['size']
metadata = json.loads((ROOT / 'manifest.json').read_text())
metadata['sceneRaster'] = {'filename': png.name, 'crs': 'EPSG:3857', 'sizePixels': [width, height], 'boundsMercator': [origin_x, origin_y + height * dy, origin_x + width * dx, origin_y], 'geoTransform': info['geoTransform'], 'bytes': png.stat().st_size, 'sha256': hashlib.sha256(png.read_bytes()).hexdigest(), 'processing': 'Geospatial reprojection and bilinear resampling only; RGB from official bands 1/2/3. UTM bounds are not used as Mercator bounds.'}
(OUT / 'scene-raster.json').write_text(json.dumps(metadata, indent=2) + '\n')
print(json.dumps(metadata['sceneRaster'], indent=2))
