# Hudson Highlands source-backed scenery

Generated: 2026-10-09T17:19:40+00:00. Route: 22.84 km southbound.

`world.json` contains longitude/latitude vectors and local east/north DEM metadata.
`elevation.f32` stores 961 × 1169 little-endian Float32 elevation
metres, west-to-east columns and south-to-north rows. Bounds identify **pixel
centres**, so use `(coordinate - min) / resolution` for bilinear sampling.
DEM range: -13.64 to 441.31 m. Sampling:
19.997 × 19.996 ground metres.

Feature counts: {"water": 326, "forest": 248, "farmland": 16, "building": 6302, "rail": 216, "road": 3335}. Water holes retained:
47.

Buildings preserve complete mapped footprints intersecting a 1200 m route
corridor; roads are clipped to that corridor. Water and wooded land retain full
regional coverage, simplified with preserved topology at 1.5 m tolerance.
Source geometry warnings: relation/8975990 (NewYork-Presbyterian/Hudson Valley Hospital): unclosed outer line fragments excluded. The hospital relation
warning does not affect any Hudson River shoreline.

Rebuild with `python app/scripts/prepare-hudson.py` using Pillow and shapely.
The script reuses checked source snapshots; `--refresh` requests current data.
`manifest.json` records exact requests, checksums, verification and known gaps;
`sources/` retains the original government and OSM responses.

Sources and attribution:
- [USGS 3DEP ImageServer](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer): bare-earth elevations; public domain.
- [FRA/BTS NTAD Amtrak Routes](https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_Amtrak_Routes/FeatureServer/0): Empire Service route; federal public data.
- [OpenStreetMap contributors](https://www.openstreetmap.org/copyright):
  vectors licensed under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
  This bundle contains an adapted OpenStreetMap database. Retain attribution and
  the applicable ODbL terms when redistributing its vector data.
- [Overpass API documentation](https://wiki.openstreetmap.org/wiki/Overpass_API).

Map data represents mapped objects, not a surveyed engineering model. Railway
centreline accuracy, missing OSM coverage and the DEM source mosaic are described
in the manifest. No terrain or shoreline was procedurally fabricated.

## Regional building overlay

`buildings.json` augments the original 6,302 OSM footprints without changing
`world.json`: OSM geometry and holes remain authoritative, while matching
Overture attributes and provenance are attached by record ID/IoU. Only
non-matching Overture components are added. The overlay contains 34,326
components and 3 building parts for release `2026-09-23.1`; 28,024 Overture
components cover the expanded regional bbox, including towns beyond the narrow
rail corridor. The Three.js loader indexes these once into 256m spatial bins
and builds visible chunks incrementally.

Height states remain explicit: source tags, upstream model estimates,
floors-only, and missing. Microsoft model heights are estimates, not surveyed
measurements. Missing heights remain footprints. Building parts use their own
`height` and `min_height`. Every feature retains geometry provenance, Overture
GERS IDs/matches, source records, release, and attribute-source metadata.

- [Overture building data guide](https://docs.overturemaps.org/guides/buildings/)
- [Overture attribution](https://docs.overturemaps.org/attribution/)
- [Microsoft Global ML Building Footprints](https://github.com/microsoft/GlobalMLBuildingFootprints)

Reproduce the offline conflation with `python app/scripts/prepare-hudson-buildings.py`
(Shapely required). `--refresh` requests upstream data. The full regional
snapshot, exact requests, partition paths, timestamps and source-response
SHA-256 values are recorded in `buildings.json` and `sources/`.

## Annual NLCD land coverage supplement

`landcover.u8` contains a 640 × 779 categorical sample of the official 2025
Annual NLCD Collection 1.2 WMS, approximately 30 ground metres per cell.
Unlike the elevation grid, its bounds are **outer cell edges** and rows run
**north to south**. `landcover.json` binds it to the unchanged world snapshot
and records its checksum, acquisition request, source capabilities, class
counts and independent GetFeatureInfo checks of forest/water/developed pixels.

The native WCS endpoint returned a server error during acquisition. The retained
PNG is decoded with exact RGB values from the USGS v1.2 user guide, table 2-2;
unknown or blended colors fail preparation. This is a categorical WMS sample,
not a downloaded native COG or a tree inventory. Run
`python app/scripts/prepare-hudson-landcover.py` with Pillow to reproduce from
checked cached responses; `--refresh` reacquires and revalidates them.

Forest classes 41/42/43 supplement unmapped OSM ground. OSM land/water polygons
retain priority and their holes; individual trees still use explicitly estimated
visual placements and heights. Woody wetlands, shrubs and developed classes
are not automatically filled with mature trees. Debug's “NLCD 分类对照” shows
the source categories without rebuilding the scene; turn off 林木 to inspect it.

- [USGS Annual NLCD classification](https://www.usgs.gov/centers/eros/science/annual-nlcd-land-cover-classification)
- [USGS science user guide](https://www.usgs.gov/centers/eros/science/annual-nlcd-science-user-product-guide)
- [MRLC official data services](https://www.mrlc.gov/data-services-page)

USGS Annual NLCD science products are public domain. Satellite classifications
can contain errors and represent predominant land cover, not surveyed objects.
