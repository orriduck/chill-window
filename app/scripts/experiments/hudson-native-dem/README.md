# Hudson native DEM diagnostic (no runtime import)

This recipe investigates the smooth slope in the user's application screenshot
at s=2790m (reported 41.417688, -73.960451). A screenshot of the app is failure
evidence, not a photograph of the physical hillside. Native 1m data may expose
sampling differences; it is not assumed to resolve the obstruction.

Run in GitHub Actions on the exact branch `codex/native-dem-diagnostic`:

```sh
node app/scripts/experiments/hudson-native-dem/sample-runtime.mjs --out "$RUNNER_TEMP/native-dem/outputs/runtime.json"
/usr/bin/python3 app/scripts/experiments/hudson-native-dem/diagnose.py --runtime "$RUNNER_TEMP/native-dem/outputs/runtime.json" --out "$RUNNER_TEMP/native-dem/outputs" --scratch "$RUNNER_TEMP/native-dem/scratch"
```

The workflow installs dependencies; local execution against remote TIFFs is
outside this task. See [plan.md](plan.md). Runtime cameras, shaders, mesh,
rail heights and elevation.f32 are not edited. The sampler uses checked-out
GeoData and TypeScript-AST-extracted RealWorld methods; only color classification
is stubbed, because it does not affect vertex positions or indices. Actual
Float32 vertex values, exact triangle indices and barycentric weights are
recorded for every sample, with the existing 0.18m ground placement. Eye height
is the existing rail height +2m; the right-window horizontal view uses the
checked-out PassengerView yaw, and the plot also shows the perpendicular right
direction. No alternative rail profile or vertical correction is applied.

Primary references (selection checked 2026-10-10; recipe records its own live
fetch time, bytes, HTTP identity and SHA for each small response):

- [USGS TNM 1m DEM query](https://tnmaccess.nationalmap.gov/api/v1/products?datasets=Digital%20Elevation%20Model%20%28DEM%29%201%20meter&bbox=-73.962,41.416,-73.959,41.42&max=5)
  and [ScienceBase product record](https://www.sciencebase.gov/catalog/item/66f61812d34edb21c7294130?format=json)
  identify the candidate tile; their spatial index alone does not validate
  pixels or native CRS. The recipe fails closed unless both actual JSON records
  match source ID `66f61812d34edb21c7294130`, the fixed TIFF URL/254,726,318-byte
  length and publication date 2024-09-25. Product XML identity/date and vendor
  date/datum fields are read and independently checked, not emitted as assumed
  observed metadata.
- [USGS native tile](https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/NY_SouthEast4County_A22/TIFF/USGS_1M_18_x58y459_NY_SouthEast4County_A22.tif):
  prior HEAD returned 254,726,318 bytes, Last-Modified 2026-02-14 (publication
  object timestamp, not acquisition). COG layout and HTTP 206 remain unverified
  until executed. Range mode records exact native window value/mask SHA and
  HTTP identity, never a fictitious complete source SHA or measured traffic.
  HEAD length must match the fixed size; a 206 response must have exactly the
  requested 16,384 bytes and matching Content-Range total. Identity mismatches
  fail immediately. Only HTTP/GDAL I/O failure or a server ignoring Range can
  trigger the cloud full-file fallback, after small metadata identity passes.
- [USGS tile XML](https://thor-f5.er.usgs.gov/ngtoc/metadata/waf/elevation/1_meter/geotiff/NY_SouthEast4County_A22/USGS_1M_18_x58y459_NY_SouthEast4County_A22.xml):
  NAD83 UTM18N, NAVD88 metres; 10012×10012; acquisition 2022-04-09–04-30.
- [Vendor XML](https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/metadata/NY_SouthEast4County_A22/NY_SE4County_1_A22/reports/vendor_provided_xml/312022452_NYSDOP_Lidar_2022_DEM.xml):
  NAD83(2011), NAVD88/Geoid18; acquisition 2022-04-14–04-30. Preserve this date
  difference. The vendor's NVA 0cm field is suspicious and is not zero-error
  evidence. Source datum declarations and decoded raster CRS are separate.
  Decoded horizontal WKT must be equivalent to EPSG:6347 NAD83(2011)/UTM18N or
  the product's generic EPSG:26918 NAD83/UTM18N; any decoded vertical CRS must
  be NAVD88 height (EPSG:5703). WGS84, Mercator and other UTM zones fail closed.
  CRS/Transformer, resolution, geometry and nodata semantics never trigger
  download fallback.
- [GDAL virtual filesystems](https://gdal.org/en/stable/user/virtual_file_systems.html)
  documents `/vsicurl/`; actual server capability is checked, not inferred.
- Current world.json uses the [official NTAD Amtrak route service](https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_Amtrak_Routes/FeatureServer/0)
  and [USGS 3DEP ImageServer](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer).
  The approximately 20m prepared DEM's vertical realization is not independently
  established here. Differences are unadjusted comparisons, not survey residuals.
- Prepared 2022-10-22 NAIP atlas pixels/alpha and EPSG:3857 placements come from
  `app/public/geodata/hudson/imagery/corridor/scene-atlases.json`:
  [NOAA collection](https://coastalimagery.blob.core.windows.net/digitalcoast/NY_NAIP_2022_9986/index.html),
  [official InPort metadata](https://www.fisheries.noaa.gov/inport/item/71609).
  Credit USDA-FSA APFO / NOAA. Reuse atlas only, with SHA verification; no new
  source imagery TIFF download. Plot registration is derived from manifest
  coordinates and still requires actual pixel inspection. Distant Little Stony
  Point photos are not evidence for this exact camera location.
- Current world OSM `railway=rail` geometries are independently compared to the
  official route. Track tags are preserved. OSM horizontal proximity does not
  establish surveyed rail height, right of way width or perfect image alignment.

Artifacts include raw small source responses, metadata/identity, runtime sample
JSON, full sample/profile CSV, difference/nodata/offset-slope/eye-overlap summary,
native hillshade and contour/NAIP/grid panels, and profile PNG. Raw 1m pixels
are retained unresampled in runner scratch and hashed before sampling, not
uploaded. Large TIFF/LAZ/EXR and scratch files are excluded. Successful collection
does not validate the gameplay picture: `runtimeImported` and `visualAcceptance`
remain false. No browser/rendering inspection is performed by this recipe.

## Bounded Putnam 2019 alternative

See [putnam-plan.md](putnam-plan.md) and [source references](REFERENCES.md).
On exactly `codex/putnam-dem-diagnostic`, the separate workflow adds
`--source-kind putnam2019` to the same diagnostic command. With no selector,
the old USGS 2022 source remains the default. Only the two official Putnam
TIFFs are fetched into cloud scratch; full bodies are hashed and excluded
from artifacts. Their actual grids/masks, aligned seam and native bilinear
coverage are measured before comparing the same unchanged runtime samples.

A complete diagnostic requires all 3865 native samples and all five exact
241-point profiles. `summary.json` records `requiredProfileCoverage`,
`allFiveProfilesComplete` and `diagnosticCompleteness`; incomplete coverage
preserves small outputs then exits nonzero. `native-validity-seam.png` shows
actual pixel validity, decoded tile bounds and invalid bilinear samples.
Geoid12B/Geoid18 and the prepared ~20m unverified realization remain explicit;
no vertical adjustment is applied. `runtimeImported`, `visualAcceptance` and
`fixAccepted` remain false. Preparation syntax checks are not raster or visual
acceptance; cloud maps/profiles still require direct inspection.
