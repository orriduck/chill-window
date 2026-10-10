# Putnam 2019 native DEM diagnostic preparation

The previous 2022 collection had only 263/3865 valid native samples and no
native evidence at 2590, 2690 or 2790m. The terrain browser run timed out after
21/28 images; the 2790m background-off image still showed the large hillside.
Neither result accepts a fix. This bounded experiment first checks a different
raw source, without changing runtime data, cameras, rail heights or terrain.

1. On exactly `codex/putnam-dem-diagnostic`, download only the two official
   Putnam TIFFs into cloud runner scratch (about 9.4MB each). Preserve the actual
   index query/geometry, source XML, ImageServer metadata, HTTP identity,
   completed download sizes and full SHA256. Index coverage is not valid pixels.
2. Fail closed on source identity, CRS, units, Float32/1m grid or incompatible
   tile alignment. Decode actual dimensions/geotransforms/masks; compare tile
   extent to its index geometry and preserve any buffer/dimension discrepancy.
   Build only a bounded native pixel mosaic, without resampling or datum shifts.
   Bilinear sampling must use all four valid neighboring pixels across the seam.
3. Reuse the unchanged AST sampler for 81 actual poses/3865 samples and five
   ±120m profiles at 2590/2690/2790/2890/2990m. Compare native 1m, prepared ~20m,
   existing rail-bed function and actual indexed 8m triangles. All 3865 native
   samples and all five 241-point profiles must be valid for completeness.
4. Always upload small PNG/CSV/JSON/XML/Markdown, including validity mask,
   seam/extent metadata and per-profile counts. Insufficient coverage writes
   diagnostics and then fails. Direct map/profile pixel inspection remains a
   separate required step; collection alone cannot accept a terrain fix.

Metadata checked 2026-10-10 declares 2019-04-23–25, NAD83(2011)/UTM18N and
NAVD88/Geoid12B. Its first abstract sentence says Niagara, while its geographic
extent says Westcheser and Putnam: preserve both. TILE_DATE=10/31/2022 is an
index date, not acquisition. The old 2022 source declares Geoid18; the prepared
20m source realization is unverified. Apply no vertical adjustment.

Local preparation permits only small metadata, Python AST/Node syntax and
source sampling checks. No local TIFF/HEAD, GDAL, LAS, Blender, browser or GPU.
Old 2022 source expectations and default workflow remain unchanged. Preparation
is uncommitted for specification and quality review before any cloud run.

## Bounded source-derived export (next preparation, 2026-10-10)

The cloud diagnostic at `e3ed000e4a6ed2511ba4d1e8b08a0c7d148db553`
completed with 3865/3865 native samples and all five 241-point profiles valid.
Its original diagnostic formats and completeness gates remain unchanged.
`export-putnam-grid.py` adds a separate cloud-only artifact after that diagnostic:

1. Reuse saved `putnam-native-window.npy`, `putnam-native-valid.npy`, metadata
   and runtime snapshot. Verify both complete TIFF SHA256/byte identities, the
   exact world SHA256/origin and loaded decoded window/mask bytes against the
   successful snapshot. No additional source fetch, warp or vertical adjustment.
2. Export the inclusive world XZ bounds `[-258,6170,188,6670]` at 2m spacing:
   224 columns × 251 rows, south-to-north, row-major. Each vertex follows exact
   `GeoData.unproject` from `[-73.96,41.36]`, then pyproj EPSG:4326 → EPSG:6347
   and existing `source.bilinear` with four valid native pixel neighbours.
   UTM coordinates are never treated as world XZ.
3. Write little-endian `elevation.f32`, explicit `valid.u8` and a manifest to
   `RUNNER_TEMP/putnam-dem/runtime-grid`, uploaded only as
   `putnam-runtime-grid-${github.sha}`. The original PNG/CSV/JSON/XML/Markdown
   diagnostic upload remains separate with seven-day retention. Total export
   stays below 1MB. Invalid vertices retain mask 0 and canonical NaN; preserve
   actual outputs then fail if any vertex is invalid.
4. The manifest labels this as derived/resampled 2m data from raw 1m 2019 DEM,
   NAVD88/Geoid12B with no adjustment, and records source/window/output hashes,
   bytes, dimensions, row order and validity counts. Runtime import and visual
   acceptance remain false. Cloud export has not yet run; runtime A/B requires
   a later implementation with debug controls and browser visual inspection.

Only lightweight AST, coordinate math and workflow checks are permitted locally
for this export preparation; no local TIFF, GDAL, downloads or browser work.
