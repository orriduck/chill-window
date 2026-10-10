# Limited native DEM diagnostic

1. Run only on `codex/native-dem-diagnostic` in GitHub Actions, without a browser,
   Blender, GPU, application build, or production data import.
2. Preserve timestamped TNM/ScienceBase JSON, both official XML records and HTTP
   identity. Actually check a 0–16383 byte Range response before using GDAL
   `/vsicurl/`; record a cloud-only full-tile fallback if range/read fails.
3. Bundle the checked-out GeoData implementation and extract the current
   RealWorld terrain methods from its TypeScript AST. Sample the unchanged
   route/rail profile and actual indexed 8m tile triangles, including the
   ground mesh's 0.18m Y placement. Never substitute heightAt for mesh height.
4. Read one native, unresampled pixel window covering s=2590–2990m and ±120m.
   Compare native bilinear ground, current approximately 20m DEM bilinear
   ground, current narrow rail-bed function, and indexed near-mesh surface.
5. Recompute route-to-OSM nearest distances, plot source hillshade/contours,
   atlas-georegistered NAIP, route/OSM/camera/rail-bed overlays, and isolated
   DEM/mesh grids. Export five cross-sections and common-valid statistics.
6. Export small PNG/CSV/JSON/XML/Markdown only. Keep source TIFF and raw native
   pixel window in runner scratch. Record `runtimeImported: false` and
   `visualAcceptance: false`; collection success is not a terrain fix.

Local verification is restricted to source/AST/JSON/YAML syntax and diff scope.
Native TIFF access, projected pixel sampling, PNG content and alignment are
unverified until the cloud recipe actually runs and its output is inspected.
