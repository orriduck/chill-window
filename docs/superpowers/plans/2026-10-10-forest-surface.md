# Hudson 2790m near forest surface comparison

Date: 2026-10-10. Scope: one material comparison, preserving source geography and current terrain default. Implement in isolated `codex/forest-surface-review`; root reviews specification then quality, commits/pushes and inspects actual cloud artifacts. This implementer does not commit/push.

## Evidence and boundary

The [actual three-state cloud run 38067994470](https://github.com/orriduck/chill-window/actions/runs/38067994470) passed runtime checks and produced same-camera 2790m PNGs. Root inspected all three: current/raw20m/native2m still show a broad gray bare bank; native is steeper. This diagnosis does not accept native terrain or change the default. Ground shader source shows GeoAerial replaces diffuse color with approximately 2.4m NAIP imagery after rock/grass; nearby steep surfaces receive a blurry top-down image.

Use [Poly Haven Leaves Forest Ground](https://polyhaven.com/a/leaves_forest_ground), photographed brown/tan/yellow/green leaf litter and twigs. Root visually inspected the downloaded original 1024² diffuse JPEG. Official physical tile approximately1.3m; API dimensions approximately1260mm. Generic photograph material, not Hudson imagery, surveyed local surface or plant placement. Authors Dimitrios Savva (Photography), Dario Barresi (Processing), CC0. Published2022-06-23; photograph date unknown; checked2026-10-10. Original 1K diffuse/roughness/displacement JPEG bytes only; no resize, retint or normal repair.

## Implementation sequence

1. Download three original1K JPEG maps. Check exact API byte counts/MD5 and JPEG header dimensions; record SHA256, URLs, authors, license and material/geography boundary in provenance.json and REFERENCES.md.
2. Add GeoForestFloor: verify provenance SHA and each map's bytes/SHA/dimensions before world.ready; abort fetches/dispose textures on errors/disposal. Diffuse SRGB once; scalar NoColorSpace; repeat/mipmaps/aniso4. Both states load three maps, all samplers appear in the real ground shader's GPU warmup.
3. Compose after GeoAerial on ground, before inherited background composition. Roof/building/water materials untouched. Existing masks and source-land diagnostic preserved. Blend triplanar photo color/roughness near actual camera: artist fade12–45m, tile approximately1.3m, bump amplitude0.006. Height affects shading only, no vertex/geography changes. Scalar/surface derivatives outside mask/fade branches; normalized PBR normal in fade, exact original normal when disabled; distant NAIP retained.
4. Plumb opt-in groundSurface=leafLitter through ThreeCanvas/RealWorld, defaultcurrent. Geographic Debug reload comparison preserves route/terrain source; 2790m shortcut; loaded filenames/SHA/bytes/dimensions, dates, CC0 attribution and generic-material/artist-parameter labels.
5. Exact-branch-only forest-surface-review.yml, excluded from generic workflow. Two actual640×360 Chromium/SwiftShader PNGs: current/leafLitter, bothcurrentterrain, exact2790m, Daylight/Clear/original layers. Actual trusted Pause before world-ready, clocks0, current and initial49/49/GPUidle/pending0/completed proof. Real fonts/twoRAFs then synchronous strict-ready recheck+RAFfreeze. Actual camera equality, PNGs/freeze-before/after and health/errors retained; resume in finally. Job15min/script600sec, serviceworkersblocked.

## Validation and acceptance

Local lightweight TS/Vite/PWA build, asset hashes/JPEG headers, shader composition/mask/coordinate source proof, script syntax and git diff --check. No local browser/UI/GPU/Blender/GDAL/TIFF/LAZ while user uses computer. Captures only GitHub Actions.

Root must inspect actual two PNGs/read health after push; runtime success does not equal visual acceptance. Defaultcurrent pending review. No full-route/motion-continuity/hardware-performance acceptance claimed by this bounded frozen comparison.
