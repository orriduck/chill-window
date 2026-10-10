# Peekskill station source audit

This experiment packages a georeferenced, source-preserving layout for the real
Peekskill Metro-North stop. It does not edit the app renderer. It reuses the
retained Hudson OSM/Overture records and the already prepared 2022 NAIP crop;
it makes no web requests and does not use generated station geometry.

## Rebuild

On Ubuntu, install GDAL's Python bindings and Pillow, then run:

```sh
sudo apt-get update
sudo apt-get install -y gdal-bin python3-gdal python3-pil
cd app
/usr/bin/python3 scripts/experiments/peekskill-station-source/prepare.py
```

`input-checksums.json` pins all eight inputs, including the image geotransform
manifest. The script verifies the route SHA, station/building overlay linkage, source
snapshot checksums, and the bundled scene PNG against its georeferencing manifest.
It emits:

- `output/peekskill-station-source.geojson`: 17 WGS84 features with exact OSM
  source IDs/tags, stop-area members, source height status, Overture GERS match,
  and EPSG:26918 projected bounds/footprint metrics.
- `output/peekskill-naip-station-source-overlay.png`: a diagnostic overlay on
  the existing source RGB crop. The input RGB crop is not modified. It shows
  platform outlines in yellow, open canopy footprints in orange, station house
  in magenta, crossing paths in cyan, and station entrances in green.
- `output/validation.json`: input/output hashes, dimensions, image provenance,
  photo-source records, height findings, and explicit data gaps.

The input is the existing runtime scene PNG, not the earlier UTM GeoTIFF:
696 × 944 pixels, 978,340 bytes, EPSG:3857, SHA-256
`b52faa3730355e2c11ffa9599ad6a311e84fc3dac647d63151eac60b8e2355e0`.
`scene-raster.json` supplies its geotransform and retains the source tile SHA
`8c35fc499c0eec831baec91c1c03edf21f7f8dad4ca50b07076c997cb67a3bb1`,
source acquisition date and original official imagery URL. The scene image was
reprojected from the prior 0.6m crop; no new imagery is requested here. Geometry
metrics use EPSG:26918, independently of the image's EPSG:3857 pixel mapping.

## Verified source geometry

- Active Peekskill platform areas: `way/533839748` and `way/533839753`, both
  members of `relation/8336095`. Each carries raw `height=4'`; the exact unit
  conversion is 1.2192 m. It is retained as a platform height and must be
  placed relative to the local rail top, not set equal to terrain elevation.
  OSM outline measurements are approximately 161.8 m × 4.3 m and 162.2 m ×
  4.6 m (principal-axis extents of source vertices, not a survey). Their areas
  are 674.850 m² and 565.598 m².
- Open canopy/shelter outlines: `way/1307801003` (378.964 m²) and
  `way/1307801004` (271.408 m²). Both retain `amenity=shelter`,
  `shelter_type=public_transport`, and missing height. They are not closed-wall
  buildings and the sidecar creates no canopy height or roof surfaces.
- Station house: `way/285221615`, 427.358 m² footprint. Overture associates
  GERS `2022c696-2786-4c11-b030-7cfb7925638b` and supplies 5.555979 m from
  Microsoft GlobalMLBuildingFootprints, explicitly `source_estimate` / model
  output. OSM contains no roof shape, roof material or facade material. The
  roof shape is not fabricated.
- Crossover topology: `way/533839749`, `533839750`, `533839751`, and
  `1307801005` link stair/footway/stair segments with `bridge=yes`, `layer=1`.
  Their source line lengths are 6.781 m, 15.223 m, 14.733 m and 13.140 m. These
  are route-segment lengths; OSM has no deck footprint, elevation, width,
  support layout or material.
- The 2022 NAIP image is used only to check plan-view alignment. It is an
  overhead image and is not a source of station height, facade imagery, or
  material labels.

## Photos and imagery

Exact-site image references with author/license and observable scope are in
`output/validation.json`. The MTA-authored 2013 image documents the renovated
Peekskill canopy/eaves, columns and attached Jan Peeck's Vine artwork. The
2014 station-house image identifies the Peekskill station house; the 2014
crossover photo identifies the station's crossing stairs. Those images are
reference evidence, not applied as textures or measured drawings. The Commons
pages provide the image licenses and original-size download URLs.

## Actual LiDAR observations (cloud only)

`lidar-selection.json` records the official USGS catalogue query checked on
2026-10-10. The 2022 tile already probed in `../peekskill-lidar` covers the west
platforms/canopies but its published geographic envelope excludes the east
station house. A 2018 tile covers the full station. Survey years and later
publication dates are separate; these sources do not prove current 2026 geometry.

The focused GitHub Actions workflow runs two independent jobs: the source-layout
audit above and `probe-lidar.py`. The latter downloads the selected official LAZ
files on the cloud runner, verifies published byte counts and the previously
observed 2022 SHA, records the actual 2018 SHA, reads each LAS CRS/axis units and
header-bound intersection fractions, and publishes bounded class-1/class-6 source point
subsets plus nearby class-2 ground observations. Heavy LAZ files stay on the
runner. Install the pinned dependencies shown in the workflow to reproduce it.

Planar clusters are source observations, not automatically accepted roofs.
Class 1 is unclassified and may include plants, platforms or crossing structures;
class 6 identifies building observations but still requires geometry review.
No vertical plane fit is produced if the source CRS omits vertical units. The
bare-earth DEM is not used to infer canopy or station-house roof heights.
The geometry job in [actual run 38053050173](https://github.com/orriduck/chill-window/actions/runs/38053050173) passed: 17 features, 9 valid polygon/line features, all 52 vertices inside the scene crop. The downloaded checksum-verified overlay was visually inspected and archived in `observations/layout-932b67d/`. The separate point job also passed. Actual source subsets and report are archived in `observations/points-932b67d/`; both observed LAZ hashes are now pinned. The 2018 tile provides 2,549 station-house unclassified points; the 2022 tile has none there. Canopy subsets contain thousands of unclassified points in both years. Neither tile supplies class-6 building points, so spatial/plane review is required before roof acceptance. The sources use distinct Geoid12B/Geoid18 realizations of NAVD88; do not combine absolute heights silently. Source roofs are not yet accepted.

No GLB is emitted in this audit. Station-house ML height can support a clearly
labelled estimate in a future model, but roof geometry/materials are missing;
both open canopy heights and crossover vertical dimensions are missing. A
source sidecar is the reviewable result until those measurements are available.
