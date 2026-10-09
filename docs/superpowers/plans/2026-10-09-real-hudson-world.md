# Real Hudson World Implementation Plan

> Execute inline with reviewed data and visual checkpoints. Existing mixed working-tree changes stay intact; no commit/push is requested.

**Goal:** A real Empire Service corridor is visible and rideable from the existing Three.js carriage, with an inspection camera using the same data.

**Architecture:** A bundled GIS/DEM snapshot feeds GeoRoute and GeoTerrain. RealWorld builds true-coordinate scenery and maps it into the current train-relative render frame; normal passenger controls remain responsive. A dedicated geographic inspector provides position, source, jump and world switching.

**Tech Stack:** Existing TypeScript, Three.js, GLTF instances; Python stdlib/Pillow for reproducible data preparation, government ArcGIS REST and OSM Overpass.

- [x] Prepare a small local data bundle under `app/public/geodata/hudson/`: FRA line, USGS float elevations, OSM geometry; manifest includes exact requests, timestamps, bounds and checksums. Never substitute invented data.
- [x] Implement `app/src/engine/three/geography/GeoData.ts`: scaled local Mercator, route cumulative metric distance, interpolation/tangent, DEM bilinear sampling and bounds checks, source profile and tags.
- [x] Implement `RealWorld.ts`: streamed detailed DEM surfaces, coarse real background, true shoreline/roads/building footprints, trees from mapped vegetation. Geometry/material ownership explicit.
- [x] Implement `GeoInspector.ts`: independent orbit camera, status/sources, route progress/jumps, geographic mode switching and F5/Esc integration before visual evaluation.
- [x] Wire `ThreeCanvas.tsx` and `Camera.ts`: injectable track profile, per-frame geographic-to-train transform, suppress synthetic exterior layers in real mode, restore them when switching back, freeze the ride during inspection, stop at corridor end.
- [x] Verify geometry/data assertions, TypeScript build, modified-file lint and real browser flows. Save screenshots outside the repo; update REFERENCES with adopted sources and observed limits.

Data contract: `world.json` has origin [lon,lat], route lon/lat points in travel order, OSM features with lon/lat coordinate rings/lines and tags; `dem` contains width/height, bounds in local metres, row order, resolution and local binary URL. `elevation.f32` is little-endian Float32 in south-to-north row order, with pixel-centre bounds described in the JSON. Route starts north and travels south so the existing right-side window faces the Hudson to the west. Geometry and sampled rail elevations are independently checked before integration.

Verification record: `docs/visual-checks/2026-10-09-real-hudson/README.md`. Data and final implementation passed spec/code review. Screenshots remain outside the project; build includes GIS precache, offline PWA runtime remains untested.
