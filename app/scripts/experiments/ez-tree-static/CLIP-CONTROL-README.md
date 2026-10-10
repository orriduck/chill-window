# Fixed Oak transparency/depth controls — diagnostic only

This bounded cloud-only recipe follows actual [normal diagnostic run 38058734557](https://github.com/orriduck/chill-window/actions/runs/38058734557), commit `c767c723c76cd2be0c1288c851ef77525ac58355`, inspected 2026-10-10. It is not a production bake. `runtimeImported`, `visualAcceptance`, `mechanismConfirmed`, and every `productionAccepted` stay false. Collection success means evidence was acquired.

The prior full decoded normal and albedo RGBA were byte-identical to failed production run 38056124740, although PNG file hashes differed due to metadata. Both the original normal and geometry-only control had the same 46 bad Oak pixels. Constant `(0.5,1,0.5)` returned `(0.125,0.25,0.125,1)` at `(193,128)`; normal returned approximately `(0.0615211,0.0176255,0.1322263,1)`, length 1.49694, and PNG `(16,4,34,255)`. The source-independent constant control therefore also lost radiance while alpha stayed one. Actual compiler finite-flag calibration failed: no invalid-input/NaN conclusion can be drawn from those flags. `clip-control-reference.json` retains the prior JSON SHA, PNG file and decoded RGBA hashes, FLOAT32 hashes and exact probes. It is a small reference, not a replacement for the original artifacts.

## Frozen scene and twelve captures

Rebuild the same pinned EZ-Tree source (`dcf309bd86bd521083d9c70f01f2de45fdc7c457`) in GitHub only, using Blender **4.0.2**, EEVEE 48 samples, Oak Large LOD0 seed 23399, source scale to 20m, yaw 135°, orthographic 22m, distance 80m and target `(0,0,10.5)`. Actual geometry, GLB factors, source UV `(u,1-v)`, textures and hashes stay unchanged. The binary source alpha node still discards `alpha < 0.5`; alpha exactly 0.5 stays opaque. Branches stay OPAQUE and culled; leaves keep the original double-sided and `show_transparent_back` policy. There are no synthetic calibration renders or source rebuilds on this computer.

| Mode | Only change | Channels |
| --- | --- | --- |
| clip-default | Original CLIP and original near/far | constant, albedo, normal |
| clip-tight-depth | Camera `clip_start/end` only, actual camera-space depth extrema ±5m | constant, albedo, normal |
| hashed-default | Leaf `blend_method=HASHED` only; original binary mask retained; negative control | constant, albedo, normal |
| blend-default | Leaf `blend_method=BLEND` only; original binary mask and backface policy retained | constant, albedo, normal |

Every channel gets independent material copies, removed after use. Every mode restores camera depth and verifies the full camera state. Tight depth uses **all actual Blender mesh vertices transformed by each object's matrix and the actual camera inverse**, not a bounding-box approximation. Requested and actual stored depth ranges, containment, world bounds, projected bounds and root pixel are recorded; every tree vertex must remain inside. `show_transparent_back=False` is deliberately never applied: its depth-only backface policy is not an alpha-mask repair.

The reviewed normal diagnostic helpers are imported directly. Each pass renders once and captures PNG plus the **same** Render Result through temporary RGBA FLOAT32 EXR readback as Non-Color. Direct RNA availability, original image metadata, exact little-endian float samples and SHA are retained. EXRs are deleted and never uploaded. CRC-checked PNG decoding records exact RGBA; there is no normalization, PNG edit, re-render, altered source mask or relaxed `length <= 1.02` gate.

Every normal/constant pass reports full-image FLOAT32 and PNG normal length distributions and counts over **1.02**, nonfinite counts, known 46 offenders and neighbor/control probes. Constant separately reports expected associated `RGB=(0.5,1,0.5)*actualAlpha`, actual radiance, errors and per-probe ratios for opaque and partial coverage. No new radiance acceptance tolerance is invented.

## Comparison and acceptance boundaries

Each mode requires **strict exact** new constant/albedo/normal PNG alpha equality and FLOAT32 alpha-bit equality. Mismatches fail collection after all twelve captures so evidence remains available. Comparisons against baseline alpha are separate measurements: BLEND may change coverage and visible leaf surfaces, and an internally consistent alpha mask is not proof of visibility correctness.

Baseline reproduction compares each entire decoded constant/albedo/normal image to the actual previous artifact hashes. File and float hashes are reported separately. A non-reproduced baseline is explicitly false and all numerical candidate gates stay false; it does not fabricate old results or prevent useful diagnostic collection.

`candidateModeNumericalGate` is a strict boolean for evidence triage: completed collection, reproduced baseline, unchanged source/geometry/UV/camera/frame/containment, within-mode exact paired alpha, and zero full-image nonfinite or >1.02 FLOAT32/PNG vectors in both normal and constant. It is never production acceptance. Constant radiance evidence still requires interpretation; BLEND does not sort individual crossing leaf triangles and can change the visible surface, so even a numerical pass requires independent visual review. Source SHA and actual geometry/UV hashes are verified before/after, original camera is restored, and production recipe/verifier remain untouched.

## Primary implementation references

Read against Blender v4.0.2, 2026-10-10:

- [EEVEE material passes, lines 502–613](https://github.com/blender/blender/blob/v4.0.2/source/blender/draw/engines/eevee/eevee_materials.cc#L502-L613): CLIP/HASHED use an opaque depth prepass with clipping and shade at depth equality; BLEND dispatch differs. This motivates tight-depth and blend controls.
- [Surface fragment output, lines 80–119](https://github.com/blender/blender/blob/v4.0.2/source/blender/draw/engines/eevee/shaders/surface_frag.glsl#L80-L119): non-BLEND alpha follows holdout rather than the source opacity; radiance and opacity are processed separately. Overlapping transparent fragments losing color while retaining alpha is a **hypothesis**, not a confirmed explanation of the prior 46 pixels.
- [Shader option dispatch, lines 1154–1205](https://github.com/blender/blender/blob/v4.0.2/source/blender/draw/engines/eevee/eevee_shaders.cc#L1154-L1205): ties material blend and depth flags to compiled shaders. HASHED with an already binary source mask is an opaque-path negative control, not a presumed fix.
- [Previously reviewed readback/PNG sources](NORMAL-DIAGNOSTIC-README.md#official-implementation-references) define the reused FLOAT32 RenderResult export and exact PNG boundary. Prior failed finite-flag calibration remains inconclusive.

## Execution and local preparation

`.github/workflows/tree-clip-control.yml` runs push/manual only on exact branch `codex/tree-clip-control`; the generic cloud visual job skips only that exact new branch in addition to its existing exclusions. Studio, surface and previous diagnostic workflows remain untouched. Source rebuild and Blender rendering occur only in the cloud. Artifact allowlist is small PNG/JSON/README/license files; raw meshes, GLB and EXR are excluded.

Local AST/JSON/YAML parsing, Node JSON/source validation, scope and whitespace checks are preparation evidence only. No local Blender, GPU, browser or heavy source download is allowed. Keep implementation **UNCOMMITTED** until parent specification and quality reviews approve commit/push. Cloud results, mechanism and visual acceptance remain unverified for this new recipe until actual artifacts are inspected.
