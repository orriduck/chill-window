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
