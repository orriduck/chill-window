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
