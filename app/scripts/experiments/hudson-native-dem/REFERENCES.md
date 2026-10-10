# Diagnostic reference index

Primary URLs, acquisition-date discrepancies, datum declarations, imagery credit
and observation limitations are listed in [README.md](README.md). These references
affect only `source.py` (official record/HTTP/native pixel acquisition),
`sample-runtime.mjs` (existing world route/OSM/DEM/runtime topology), `plots.py`
(native contours and prepared NAIP atlas georegistration) and `diagnose.py`
(unadjusted height/slope/error comparison). They do not authorize a new runtime
terrain import or establish the exact appearance of the user's physical location.

The diagnostic's map and profile controls are the bounded CLI inputs, fixed
81 route positions and five complete cross-sections in [plan.md](plan.md).
No application visual feature or new gameplay/debug state is added by this
offline scientific comparison.

## Putnam 2019 alternative (selection checked 2026-10-10)

- [NY FEMA Central DEM XML](https://gisdata.ny.gov/elevation/DEM/FEMA_2019_DEM/UTM18N_BLOCK01_DEM.xml): actual 8466 bytes, SHA256 `323ae1b0c2b1298f35c438b3e16736d18f66ecfca8fd737b0b09610612eaa32f`. Acquisition 2019-04-23–25; NAD83(2011)/UTM18N, NAVD88/Geoid12B metres; 1m Float32, metadata 1500m tiles. Its Niagara first sentence contradicts the Westcheser/Putnam geographic extent; retain actual XML and contradiction. Used by `state_source.py` and Putnam summary datum comparison.
- [Official DEM index layer 2](https://elevation.its.ny.gov/arcgis/rest/services/Dem_Indexes/FeatureServer/2): actual polygon query over the bounded s=2590–2990 ±120m window returns OBJECTID 19483 and 19223. Exact query parameters/geometry are in `state_source.py` and emitted as `putnam-index-query.json`; actual returned polygons are archived in `putnam-index.json`. Native validity must be decoded; neither PARTIAL=null nor TILE_DATE=10/31/2022 establishes acquisition or valid coverage. Dynamic query bytes are observed and hashed, not pinned as an immutable source identity.
- [North raw tile](https://gisdata.ny.gov/elevation/DEM/FEMA_2019_DEM/Putnam/18TWL865855.tif) (indexed 9,442,572 bytes) and [south raw tile](https://gisdata.ny.gov/elevation/DEM/FEMA_2019_DEM/Putnam/18TWL865840.tif) (indexed 9,442,570 bytes): only these two complete TIFFs may download, in cloud scratch. No local TIFF or HEAD was requested in preparation. Actual dimensions, geotransforms, CRS, masks and complete SHA remain pending cloud execution. `state_source.py` copies exact aligned pixels, refuses conflicting overlap and never turns nodata into ground at zero.
- [Official FEMA 2019 ImageServer metadata](https://elevation.its.ny.gov/arcgis/rest/services/FEMA_2019_1_meter/ImageServer?f=pjson): actual 1m F32, horizontal latestWkid 6347 and vertical 5703. This supports selection; ImageServer point values and coverage do not substitute for raw native TIFF evidence. Used only for metadata checks, no exported resampled service raster.

`putnam-plan.md`, `state_source.py`, selector in `diagnose.py`, validity/seam plot in `plots.py` and `.github/workflows/putnam-dem-diagnostic.yml` implement this isolated alternative. Old USGS 2022 acquisition/default remain intact. All differences are unadjusted; native source maps and five profiles need direct pixel inspection after cloud execution. No runtime import or fix acceptance occurs.
