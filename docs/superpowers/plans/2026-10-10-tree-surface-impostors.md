# Tree surface impostors implementation plan

> **For agentic workers:** Use subagent-driven-development for recipe implementation, then independent specification and code review. User has authorized autonomous choices and cloud-only heavy processing/browser inspection.

**Goal:** Prepare source base-colour and normal views of the existing trees so distant canopies can receive scene lighting without using the failed prelit studio images as albedo.

**Architecture:** Keep the fixed Ash/Oak source meshes, seeds, 20m presentation scale and eight 22m camera frames. Render separate albedo (sRGB, emission strength 1, no studio illumination) and local normal (linear data) passes in cloud Blender. Both passes use the same source leaf alpha mask and source geometry; losslessly pack each into separate atlases with explicit source hashes, coordinate spaces and alpha/normal validation. Integrate only after actual output inspection and runtime comparison.

**Tech Stack:** Existing fixed EZ-Tree raw geometry/export, Blender4.0.2 Eevee, Python/Pillow verifiers, GitHub Actions.

## Design choices

The rejected alternatives are multiplying RGB brightness in the viewer (would conceal bad source colour), and leaving the prelit studio frames in place (already failed actual 150m/650m visual checks twice). Base-colour plus local normal views preserve source surface information and let the runtime use its daylight/weather lighting. Pixel transforms used to encode normals must be documented; baked images change, but raw geometry and original leaf/bark texture bytes do not.

## Recipe task

- [ ] Create `app/scripts/experiments/ez-tree-static/render_tree_surface_impostors.py`, reusing the existing fixed geometry and camera helpers rather than generating another forest or changing geometry.
- [ ] Albedo material: source sRGB base texture times the exact linear factor used by the existing GLB exporter; link to ShaderNodeEmission with strength1. Leaf visibility uses source PNG alpha cutoff0.5 and transparent background. Disable colour exposure changes and studio lights for this pass; Standard view transform outputs sRGB.
- [ ] Normal material: encode the visible surface shading normal into tree-local Three.js Y-up XYZ, `(normal+1)/2`; use Raw view transform for data. Preserve the exact same geometry/camera and leaf mask. Mark normal images as linear data, not photographs. Branch normal-map interpretation must be explicit; no claimed measured local tree normals/heights/species.
- [ ] Record every actual rendered frame SHA/byte count, source mesh/texture hashes, camera/root/mesh bounds, data-space mapping, material factors and Blender version. New files go in `surface-impostors/`; retain old studio outputs/manifest for comparison.
- [ ] Create a verifier that reads all actual PNGs, checks complete16 albedo+16 normal frames, fixed source hashes/seeds/bounds/root, transparent padding, matching alpha masks (report any renderer differences instead of widening a threshold silently), and decoded unit-normal lengths with quantization tolerance. Record opaque RGB/alpha statistics without a target-brightness gate.
- [ ] Losslessly pack four2048x1024 atlases; read back every cell and compare source pixel SHA. Manifest names channels, colour spaces, normal coordinate mapping and source attribution.
- [ ] Add a focused cloud workflow on `codex/tree-asset-preparation` paths for the new renderer/verifier/packer. Rebuild/verify pinned source meshes, install fixed Blender4.0.2, render passes and upload actual images/manifests/report/license notices. All heavy work runs in cloud; do not run Blender or download source datasets locally.
- [ ] Syntax-check recipe scripts, independently review spec and code, then commit/push to dispatch this changed recipe once. Inspect actual produced images before runtime changes.

## Runtime and acceptance follow-up

`GeoTreeImpostors.ts` must eventually verify/load all four assets before departure. `GeoForest.ts` must sample straight albedo colour and tree-local normals with alpha-aware angular/mip handling, rotate normals by instance/root/view transforms and retain weather lighting/fog. Debug must expose old/new surface sampling before screenshots. Actual40/90/150/650m/four-direction comparisons, forest continuity and full-route readiness remain required. This recipe is preparation only, not tree or full-goal visual acceptance.
