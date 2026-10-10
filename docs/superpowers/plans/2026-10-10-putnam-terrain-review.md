# Bounded Putnam terrain A/B preparation

Status: implementation prepared; **actual cloud passenger PNGs and visual acceptance pending**.
Default terrain remains `current`. The source hill is retained; camera and rail
profile are unchanged. No claim of a fix, current physical ground truth, route-wide
continuity or hardware performance follows from this preparation.

## Evidence and sources

The screenshot at 2790m is application failure evidence. The parent investigation
inspected the actual source/NAIP contour panels and complete native cross-sections,
which supported testing the existing 20m DEM, 8m mesh and ±18m rail-bed spread
separately from the real hill (about 17.7m crest). The source acquisition is 2019,
not the 2022 index date. No vertical alignment or terrain lowering is applied.
Sources and exact repro links are in `REFERENCES.md`.

The successful [source export run 38065416131](https://github.com/orriduck/chill-window/actions/runs/38065416131)
at `a8ab3d51d8af87e8baf73f8c9ebaa37f0e4fa05b` produced all 56224 valid
vertices, zero nodata. The three files are imported byte-for-byte. Their manifest
retains the export-time `runtimeImported/visualAcceptance/fixAccepted: false`
as historical provenance; the Debug readout separately reports the actual runtime
load and fixed manifest SHA. The source exporter stays on its original branch.

## States and boundaries

Open `/?world=hudson&routeMetres=2790&terrainSource=MODE`, or use the Debug
source selector (reload and prepare at the actual current train position):

- `current`: existing terrain and ±18m rail-bed visualization, unchanged.
- `raw20m`: current raw DEM inside the local core, bypassing the wide rail bed.
- `putnam2019`: verified world-XZ derived 2m grid from the raw 1m Putnam DEM,
  bypassing the wide rail bed in the local core.

The patch has inclusive world XZ bounds `[-258,6170,188,6670]`, 224×251
vertices, south-to-north / west-to-east rows, origin `[-73.96,41.36]`.
Four valid 2m neighbors are required for runtime bilinear sampling. Fixed code
SHA anchors authenticate manifest, elevations, validity and the base world;
size, dimensions, origin, mask values, finite elevations and counts are checked.
A requested native load error is explicit and prevents readiness. Outside or
invalid samples use current terrain and are labeled current by the diagnostic.

The outer 32m ring blends current to candidate terrain. This is a scene transition,
**not measured ground**. Only 9 overlapping 256m detail tiles become 2m in native
mode; background stays current 64m, other tiles stay 8m. Dense exterior-edge
vertices linearly interpolate actual neighboring 8m node heights, including
Float32 mesh rounding. Dense/dense boundaries share samples; no overlapping
second mesh is added. Native normals use actual triangle geometry. Trees,
roads and building ground attachments use the selected terrainHeight function.
GeoData.heightAt, railHeight/grade/profile, TrainCamera and source world remain
unchanged. The existing GPU fence, readiness and 49 tile gates remain intact.

Debug includes a 2790m jump, the three-state source selector, date/datum/derived
sampling/boundary notes, actual mode/manifest SHA/refined-tile readout, and a
refresh control for three passenger terrain rays. These rays are captured once
when paused, ready, GPU idle and back in passenger mode. Raycaster.setFromCamera
uses the actual TrainCamera camera; camera and world matrices are updated and
GIS origin/direction/hits use inverse world matrix. Hits are uploaded visible
detail ground meshes; null hits are valid. Water features are excluded through
GeoData, whose geometry boundary may differ from shader rasterization. This is
rendered 2m triangle evidence, **not raw native 1m ray proof**.

## Cloud validation and acceptance

`putnam-terrain-review.yml` executes only on exactly
`codex/putnam-terrain-review`; the generic cloud capture skips that branch.
Node 22 builds the actual PWA; Chromium uses SwiftShader at 640×360 with service
workers blocked. The 15-minute job bounds the script at 600 seconds and uploads
only small PNG/JSON/log outputs. No browser/GPU/GDAL/source TIFF runs locally.

Capture exactly three PNGs at 2790m, Daylight/Clear, all default layers and the
same actual passenger camera. Board, wait for the actual Pause hitbox, then click
its fresh center through a trusted pointer before world readiness. Confirm Resume,
exact route and focus/segment=0. Require actual presentable, current 49/49 detail
coverage, completed GPU preparation, idle and zero pending uploads, actual ray
report, fonts and two actual RAFs. Reuse the existing freeze/resume screenshot
contract, and require stable scene frame/callback count and successful resume.
Read and compare the actual camera positions/quaternions across the three states.
No DOM-forced pause, eye-height change, camera tilt or altered source pixels.

A cloud success is capture evidence only. Inspect each actual PNG and read the
ray report before accepting the visual result. Record obstruction shape, rail
cut steepness, real crest retention and any seams/attachment errors. Keep the
native mode opt-in unless the observed evidence supports a later decision.

## Lightweight preparation verification

`npm run build` passed (TypeScript + Vite + PWA). Capture script syntax and
`git diff --check` passed. An uncommitted temporary Node harness loaded actual
source bytes and checked all fixed SHAs, four tampered-file rejection paths,
inclusive source corners/outside null, 2790m coverage, and byte-identical current
positions/normals/colors/UV/indices for two actual 8m tiles and one 64m patch.
It checked 1544 outer vertices on all 9 refined tiles against actual Float32 8m
edge endpoints (exact Float32 equality after interpolating rounded coarse nodes). At 2790m GIS XZ is
`[-37.68497689713365,6424.679559790691]`; derived native height is
`3.9899762350734718m`, unchanged rail profile `5.733752879618809m`.
This is coordinate/geometry verification, not browser or visual validation.
