# Hudson corridor source buildings implementation plan

> **For agentic workers:** Use subagent-driven-development for independent preparation and review; controller integrates the tightly coupled runtime changes. Steps use checkbox tracking. User authorizes autonomous decisions and cloud QA; do not interrupt their desktop or ask for another execution choice.

**Goal:** Replace all 5,853 source-height buildings in the current 1,200m-per-side railway corridor with independently verified OSM2World meshes, prepared before departure, while keeping source estimates and appearance proxies explicit.

**Architecture:** Package the actual successful Actions batch into immutable GLBs, 16 shared content-addressed images, and a checksum-pinned compact catalogue. Import the exact replacement ID set synchronously, then load verified images once and GLBs with bounded concurrency. Bake each converter projection into ride coordinates, validate source identities/heights/structural boundaries, and merge by spatial region and material; prepare the original comparison at the same time. Both participate in existing initial GPU preparation.

**Tech Stack:** Python standard library for packaging, TypeScript/Three.js GLTFLoader, existing source GeoData/DEM/NAIP and GitHub Actions Chromium visual review.

## 1. Package actual accepted output

Files: create `app/scripts/experiments/osm2world-corridor/package-runtime.py`, `app/public/models/osm2world/hudson/`, `app/src/engine/three/geography/GeoCorridorBuildingRecords.ts`.

- [x] Read `/tmp/chill-buildings-e3b050c/reports/source-geometry-verification.json` and require passed=true, errors=[], 415 tiles, 5,853 buildings.
- [x] Verify every GLB/image against its actual manifest SHA/byte count; only include occupied `tile-*` folders, excluding out-of-corridor controls.
- [x] Generate this runtime JSON contract (no runner-local paths):

```ts
interface CorridorBuildingRecord {
  sourceId: string; transportId: string; heightMetres: number;
  heightStatus: 'source_tag' | 'source_estimate'; openRoof: boolean;
}
interface CorridorBuildingTile {
  uri: string; sha256: string; bytes: number; origin: [number, number];
  records: CorridorBuildingRecord[];
}
interface CorridorBuildingCatalog {
  schemaVersion: 1; worldSha256: string; buildingsOverlaySha256: string;
  tiles: CorridorBuildingTile[];
  textures: { uri: string; sha256: string; bytes: number; mimeType: string }[];
  totalBuildings: number; modelBytes: number; textureBytes: number;
  sourceTags: number; sourceEstimates: number; openRoofs: number;
}
```

- [x] Emit `corridorBuildingIds: readonly string[]`, `corridorBuildingCatalogSha256`, `corridorBuildingCatalogUrl`, and `corridorBuildingTotal=5853` in the generated TS module. Sort IDs for determinism, preserve actual converter origins read from the plan/GLB, and retain audit/source references.
- [x] Run `python3 app/scripts/experiments/osm2world-corridor/package-runtime.py --source /tmp/chill-buildings-e3b050c`. Verify 415 GLBs, 16 images, exactly 5,853 unique IDs and actual source heights. Independently review spec, then code quality.

## 2. Import source meshes before departure

Files: modify `GeoConvertedBuildings.ts`; create focused `GeoCorridorBuildingAssets.ts` for checked fetches/shared texture handling; retain exported `convertedProjection` for legacy projection checks.

- [x] Import synchronous `corridorBuildingIds` as `replacedIds` before RealWorld prepares distant or chunk buildings.
- [x] Fetch/hash catalogue; require exact total/IDs/source-world checksums. Verify/fetch all 16 image bytes once, decode each once; custom LoadingManager image handler returns clones sharing the same THREE.Source. GLTFLoader applies samplers and colour spaces to each clone.
- [x] Load at most four GLBs simultaneously and checksum each before parsing. Require every record’s node_extras transport ID and source feature/height status; reject defaults and unmatched nodes. Yield between tiles to avoid blocking the loading UI.
- [x] Project each tile from its own converter origin: `scale=cos(worldOriginLat)/cos(tileOriginLat)`, `x=origin.x+sourceX*scale`, `z=origin.z-sourceZ*scale`, `y=groundAt(featureCentre)+sourceY`. Reverse triangle winding after Z reflection.
- [x] Validate structural lowest/ground vertices against outer and hole boundaries (1cm), height within 1mm. Report converter window offsets separately; four source open roofs must remain above ground, with no invented walls. Use actual source colour or existing neutral palette with restrained generic surface detail.
- [x] Merge by 1,024m region and semantically identical material/texture state. Retain original comparison geometry per region; open-roof comparison stays roof-only. Keep all distant source imports available rather than introducing a fade hole where fallback IDs were removed.
- [x] Keep current RealWorld assetsReady and actual initial GPU fence gate; visibility switching cannot fetch, parse, compile, or rebuild geometry. Dispose all owned resources on cancellation.

## 3. Debug and cloud verification

Files: modify `GeoInspector.ts`, `.github/workflows/cloud-visual-review.yml`, `REFERENCES.md`.

- [x] Replace 15-building labels with actual total, source_tag/source_estimate/open-roof counts, 415 prepared blocks, 16 shared image files, exact download bytes and alignment statistics; publish machine-readable dataset values.
- [x] Add a focused `codex/building-visual-review` cloud path. Hold one corridor GLB to prove no departure before all models arrive, then verify all 415 unique model URLs and 16 unique image URLs request once, and no new source requests after scene/control changes.
- [ ] Capture source/original comparison, four station-area building contexts and held-load state. Preserve actual ready/GPU checks, source diagnostics and health artifact; inspect downloaded PNGs before accepting appearance.
- [x] Run `npm run build` from app and meaningful existing projection/source tests. Push the review branch, inspect actual cloud results, and keep PR draft while trees/stations/full-route continuity remain unverified.

## Acceptance boundaries

This plan advances building quality and predeparture preparation; it does not by itself complete the five-part goal. Full-route travel, source stations and realistic woodland require their own actual visual/interaction evidence. Conversion roof thickness/window surfaces are appearance proxies; DEM placement is not roof LiDAR. Original cloud byte differences are not claimed identical without semantic comparison.

## Current execution evidence

Packaging verify-only, 7 existing GeoData tests and production tsc/Vite build passed. Independent spec review and code quality review approved actual changes; they do not establish visual acceptance. Actual Actions 38047928868 loaded all 5,853 models across 415 GLBs and 16 shared image Sources; held-model departure gating and source/original/hide controls passed. It FAILED while preparing Manitou (36/49 visible chunks, 95 pending GPU); only Cold Spring and Garrison contexts completed. Downloaded PBR/original and Garrison PNGs were inspected: generic building masses remain and distant crowns are excessively dark. All four contexts and full-route continuity remain unverified; do not mark the capture/acceptance checkbox complete.
