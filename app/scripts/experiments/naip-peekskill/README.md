# Peekskill 2022 NAIP RGB crop

This is a real, unaltered-color RGB orthophoto crop for the Peekskill, New York
area. The source is the official USDA FSA NAIP 2022 New York imagery distributed
by NOAA Digital Coast. The source tile and all derived files are hash-recorded in
`manifest.json`.

## Rebuild

Requires Python 3 and GDAL CLI tools (`gdal-bin` on Ubuntu). The script downloads
and verifies the official NOAA HTML index, tile-index ZIP, and the 446 MB source
GeoTIFF, confirms the requested WGS84 bounding box selects that tile, then makes
the RGB GeoTIFF, PNG, JPEG, and world file.

```sh
sudo apt-get update
sudo apt-get install -y gdal-bin
python3 prepare_naip_peekskill.py
```

`data/` and `output/` are created alongside the script. `data/` contains the
large downloaded source and index files; `output/` contains all generated crops.
The PNG is lossless; JPEG uses quality 95. Both are resampled by GDAL to the
requested 0.6 m grid. No color correction, sharpening, painting, or generative
image processing is performed. The GeoTIFF is the georeferenced authoritative
crop; the world file georeferences the PNG/JPEG preview.

## Source and credit

- NOAA Digital Coast index: <https://coastalimagery.blob.core.windows.net/digitalcoast/NY_NAIP_2022_9986/index.html>
- NOAA InPort metadata: <https://www.fisheries.noaa.gov/inport/item/71609>
- USDA FSA APFO is the imagery program/source; NOAA distributes this New York
  collection. NOAA metadata states no access limitations and no use constraints,
  while asking users to credit USDA-FSA APFO in derived products. This package
  retains that credit and does not assert a separate license grant.
- Tile suffix `20221022` is recorded as 2022-10-22 from the source tile name;
  the NOAA record gives the statewide acquisition window as 2022-04-30 through
  2022-11-26, not an independent per-tile date field.

See `manifest.json` for source, crop, CRS, band, size, and SHA-256 details.
