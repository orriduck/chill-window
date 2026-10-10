# Fixed Oak 135 normal diagnostic — not an accepted asset

This cloud-only recipe investigates failed surface run [38056124740](https://github.com/orriduck/chill-window/actions/runs/38056124740), commit `0b1b69d5e25a1d53563807110b1652ba784602d0`. It does not change production encoding, the `length <= 1.02` verifier gate, source assets, runtime, or acceptance flags. No repair is assumed. `runtimeImported`, `visualAcceptance`, and `mechanismConfirmed` remain false.

Actual failure evidence, inspected 2026-10-10: all 20 production calibrations passed, UV identity passed, and all 16 paired alpha masks were identical. There were 86 decoded vectors above 1.02 among 1,107,566 nonzero-alpha pixels; 51 had alpha 255 and 22 had fully opaque 3×3 neighborhoods. Oak 135 had 46 offending pixels, 31 opaque and 12 opaque-interior. Its pixel `(193,128)` was normal RGBA `(16,4,34,255)`, length `1.4969249526029988`, with albedo `(44,54,31,255)`. The immutable reference JSON includes all 46 Oak 135 offenders, production source hashes, PNG hashes, manifest hash, and evidence-file hashes. The downloaded original artifact and complete 86-pixel diagnosis remain separately preserved at `/tmp/chill-tree-surface-failure-38056124740`; this recipe does not replace them.

Ordinary nearest RGBA8 quantization of a unit direction has the upper bound `1 + sqrt(3)/255 = 1.0067923561081134`. Low coverage can amplify straight-alpha rounding, but the opaque-interior 1.497 case cannot be explained by that bound. The production shader already normalizes its direction before encoding. A suspected invalid shader intermediate or missing radiance remains an inference, not a confirmed cause.

## Exact bounded scene and comparisons

The workflow rebuilds and verifies the pinned EZ-Tree `dcf309bd86bd521083d9c70f01f2de45fdc7c457` originals in the cloud. It constructs only Oak Large LOD0, seed 23399, using the existing production renderer's mesh/material/camera functions. Original normals, textures, linear tint factors, UV `(u,1-v)` assignment, source alpha cutoff 0.5, culling, orthographic 22 m frame, root position, 135° camera, 512² resolution, EEVEE 48 samples, transparent film, zero dither/exposure, and gamma 1 are retained. Every raw/GLB/source texture/preset hash is checked before and after. Source hashes also compare to the actual failed-run reference.

Six passes use this same tree geometry and camera; none is a runtime candidate:

| Pass | Measurement |
| --- | --- |
| albedo | Unchanged Standard-view production color, coverage reference |
| normal | Unchanged Raw-view production normal chain |
| geometry-only | Branch NormalMap replaced only by Geometry.Normal; both the facing dot and vector input change together; leaves unchanged |
| constant | Encoded unit local +Y `(0.5,1,0.5)` bypasses normals but retains source alpha/culling |
| length-finite | Source vector length, source-component finite-check product, post-Normalize vector length in RGB; diagnostic data |
| encoded-finite | Per-component self-compare flags for the original encoded RGB; diagnostic data |

The script reads each result from one render. It first attempts `bpy.data.images['Render Result'].pixels.foreach_get` and records whether the API exposes the complete float buffer. It saves that same Render Result to temporary `OPEN_EXR`, RGBA, **32-bit FLOAT**, ZIP, then loads it as Non-Color and records associated/premultiplied RGBA values, original image metadata, full-buffer SHA, distributions, and exact little-endian float32 hex at reference pixels. A missing direct RNA buffer is reported explicitly; the EXR extraction is never mislabeled as direct API access. Where available, direct and EXR buffers are compared. EXRs are deleted after readback and are never uploaded.

Exact PNG bytes are decoded independently with CRC-checked standard PNG filters. Raw-view unassociated float RGB is compared to nearest RGB8 bytes; Standard-view albedo has no such direct byte prediction because it receives sRGB encoding. Both the recorded premultiplied floats and the derived straight RGB remain in the report, so alpha division is visible and auditable. The script does not normalize, overwrite, or hand-correct PNG pixels. Production-frame finite/vector-length/alpha distributions and all 46 prior Oak offenders plus neighboring/control pixels are measured. Exact PNG alpha equality is checked across all six passes; any mismatch is reported and fails collection without a relaxed threshold.

The constant pass independently records errors against `RGB=C*A` and `RGB=C` for every finite partial-coverage float pixel, with `C=(0.5,1,0.5)`. These actual distributions test the association convention rather than inferring it solely from `alpha_mode`. The report retains both hypotheses and applies no acceptance threshold to this diagnostic comparison.

## Actual shader validity control

Before the tree passes, two renders of one synthetic plane calibrate shader finite-check behavior on the actual compiler. A Non-Color FLOAT image feeds RGB `(-1,0,4)` into three Math `INVERSE_SQRT` nodes: negative-domain input, zero (infinity), and a finite 0.5 control. Its left half is opaque and its right half uses the same explicit CLIP/Transparent mask construction. One pass emits those outputs; another emits self-compare flags, expected opaque RGB `(0,0,1)` if the actual shader implements the intended finite test.

This is a diagnostic probe of compiler behavior: GLSL invalid inputs and optimizer behavior can be implementation-dependent. The report records raw/output floats, PNG values, transparent/opaque controls, Blender build flags, requested environment and actual GPU vendor/renderer/version/backend when available. If the real flag calibration fails, `finiteFlagsUsableOnThisActualCompiler` is false and production finite flags are **inconclusive**. Black/sanitized final color alone does not prove which intermediate was invalid. This control does not alter the production tree's NormalMap input or final normal image.

The artifact allowlist uploads only small JSON/PNG/README/license files. It excludes source meshes, GLBs and EXRs. A collection success means evidence was acquired; it never means the normal failure has been repaired or visually accepted. Production `length <= 1.02` remains the rejection criterion.

## Official implementation references

Read against Blender v4.0.2 on 2026-10-10:

- [Image.pixels RNA getter](https://github.com/blender/blender/blob/v4.0.2/source/blender/makesrna/intern/rna_image.cc#L568-L588): float buffers are copied directly; byte buffers expose byte/255. Image buffer properties describe the internal buffer, not the saved file.
- [Image.save_render](https://github.com/blender/blender/blob/v4.0.2/source/blender/makesrna/intern/rna_image_api.cc#L48-L79): saves a copy using the selected scene's render image settings.
- [FLOAT32 OpenEXR write](https://github.com/blender/blender/blob/v4.0.2/source/blender/imbuf/intern/openexr/openexr_api.cpp#L532-L581): FLOAT channels take float-buffer values directly. [Read/association](https://github.com/blender/blender/blob/v4.0.2/source/blender/imbuf/intern/openexr/openexr_api.cpp#L1889-L1974) reads FLOAT channels and identifies premultiplied alpha.
- [Math compare](https://github.com/blender/blender/blob/v4.0.2/source/blender/gpu/shaders/common/gpu_shader_common_math.glsl#L194-L197) evaluates `abs(a-b) <= max(epsilon,1e-5)`; [inverse sqrt](https://github.com/blender/blender/blob/v4.0.2/source/blender/gpu/shaders/common/gpu_shader_common_math.glsl#L49-L52) directly evaluates GLSL `inversesqrt`. Actual shader calibration is essential before interpreting these flags.
- [Vector Normalize](https://github.com/blender/blender/blob/v4.0.2/source/blender/gpu/shaders/material/gpu_shader_material_vector_math.glsl#L64-L73) initializes its output from the input and normalizes only for positive squared length. This does not establish the finite state of actual source inputs.
- [NormalMap tangent transform](https://github.com/blender/blender/blob/v4.0.2/source/blender/gpu/shaders/material/gpu_shader_material_normal_map.glsl#L4-L24) gives the original branch tangent path; [projection-aware camera vector](https://github.com/blender/blender/blob/v4.0.2/source/blender/draw/intern/shaders/common_view_lib.glsl#L14-L19) explains the unchanged orthographic Incoming policy.
- [Offline temporal accumulation](https://github.com/blender/blender/blob/v4.0.2/source/blender/draw/engines/eevee/shaders/effect_temporal_aa.glsl#L102-L108) mixes samples then calls `safe_color`; [safe_color](https://github.com/blender/blender/blob/v4.0.2/source/blender/draw/intern/shaders/common_math_lib.glsl#L243-L251) clamps to avoid invalid black artifacts. These sources motivate measurement; they do not confirm the current cause.
- [Float-to-byte alpha predivide](https://github.com/blender/blender/blob/v4.0.2/source/blender/imbuf/intern/divers.cc#L152-L179), [nearest byte conversion](https://github.com/blender/blender/blob/v4.0.2/source/blender/blenlib/intern/math_base_inline.c#L725-L737), and [PNG unassociated-alpha output](https://github.com/blender/blender/blob/v4.0.2/source/blender/imbuf/intern/format_png.cc#L45-L61) define the pre-PNG/PNG boundary this recipe measures.

## Execution and review boundary

`.github/workflows/diagnose-tree-normal.yml` triggers only on the exact branch `codex/tree-normal-diagnostic` and diagnostic recipe paths. Manual dispatch has the same exact job guard. The general cloud visual-review job skips this branch, so this bounded diagnostic does not start the unrelated app build/browser capture. The old studio and production surface workflows remain unchanged and retain their existing branch/path/manual behavior.

Local preparation checks are Python AST, JSON/YAML parsing, source/diff scope and whitespace only. No local Blender, GPU, browser, source reconstruction or heavy download is used. Commit/push/dispatch requires parent specification and quality review. Actual float-buffer accessibility, invalid-shader calibration, reproduction, and diagnostic output remain cloud-unverified until that reviewed run is inspected.
