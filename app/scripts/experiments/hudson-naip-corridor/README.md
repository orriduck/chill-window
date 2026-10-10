# Real Hudson corridor NAIP imagery

The recipe uses the pinned 443-point Hudson route (`world.json` SHA-256
`c4a2eaea1d1ffc3d1f9c346dcceb812f10a4efb9755da146d4c18249002393ec`).
It constructs a 1200m buffer on each side in EPSG:26918 and verifies the minimum
six-tile NOAA index coverage. Only those six official 2022 New York NAIP
GeoTIFFs are downloaded, with SHA verification before any raster processing.

The route mosaic uses RGB bands 1/2/3, average downsampling and EPSG:3857
2.4m projected pixels. Blocks are stored as 427px JPEGs plus actual route
cutline/coverage masks. The atlas script losslessly copies decoded JPEG RGB
and mask alpha into three 4096px PNGs, checks all source pixels and edge
padding, and writes coordinates, pixel rectangles, dates, credits and hashes
to `scene-atlases.json`. Atlas pixels do not recover uncompressed GeoTIFF
colors: they preserve the previously encoded JPEG pixels without extra color
edits. The date 2022-10-22 comes from the source tile filenames.

The GitHub Actions workflow installs GDAL/OGR, numpy and Pillow on Ubuntu
24.04, runs the three scripts and exports only derived atlases and manifests.
The roughly 2.53GB source TIFFs are neither committed nor downloaded locally.
Use `/usr/bin/python3` so the system GDAL bindings are available.

```sh
mkdir -p source
bash download-six.sh
/usr/bin/python3 prepare_hudson_naip_corridor.py --route /path/to/app/public/geodata/hudson/world.json --sources source --tile-index source/tileindex_NY_NAIP_2022.zip --out release
/usr/bin/python3 prepare_scene_atlases.py --manifest release/manifest.json --blocks release/blocks --out release/atlases
```

Source: [NOAA official New York index](https://coastalimagery.blob.core.windows.net/digitalcoast/NY_NAIP_2022_9986/index.html)
and [NOAA InPort metadata](https://www.fisheries.noaa.gov/inport/item/71609).
Credit USDA-FSA Aerial Photography Field Office (APFO); NOAA distributes this
collection. The official record states no access/use constraints and asks for
APFO credit in derived products. Image preparation does not itself prove
application alignment, shader filtering, rendering readiness or visual
acceptance. In particular, the atlas sampler must use explicit tile-local
derivatives and protect crop boundaries when generating mipmaps.
