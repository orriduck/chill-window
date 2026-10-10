# Close-range tree model candidates

Both processed GLBs are CC0 derivatives of public Innerscene models. Complete source binaries, pinned conversion settings, and SHA-256 values are retained under `app/scripts/tree-assets/` and the adjacent `.provenance.json` files.

- `mature-scots-pine-lod.glb`: original 18m Scots pine; 54,318 source triangles reduced to 6,588; two 64×64 embedded base-color images. The source species is not asserted as a locally surveyed/native Hudson Valley tree. Do not replace all mapped woodland with pine.
- `oak-street-tree-lod.glb`: the source-described oak street-tree form is about 8.6m overall; 213,372 source triangles reduced to 10,668. It has four authored base-color materials and leaf mesh geometry, with no image textures. Keep it at authored scale; do not enlarge it into a mature forest tree.

Rebuild either asset with `python3 app/scripts/prepare-close-tree.py pine|oak --cli /path/to/gltf-transform`. The CLI is pinned to `@gltf-transform/cli@4.5.1` by the default npx command.

The independent `geography/GeoCloseTrees.ts` helper consumes placements with an explicit asset key. It does not infer real species or tree locations from NLCD/OSM. The root integration must decide which visual samples are appropriate, prepare assets before the scene is marked ready, and compare the close 3D layer with the existing far forest patches in cloud browser review.
# Phototextured source comparison

`polyhaven-pine-native.glb` and `polyhaven-pine-branch50.glb` come from the official [Poly Haven Pine Tree 01](https://polyhaven.com/a/pine_tree_01) CC0 Blender source, exported using pinned Blender 4.4.3. The delivered assets and all image/geometry hashes were rebuilt in [Actions](https://github.com/orriduck/chill-window/actions/runs/38014443841) and independently checked after download.

Both keep the authored approximately 20.4m height, source foliage alpha and PBR images. Native A LOD2 is 416,451 triangles / 24,328,860 bytes; the branch-only simplification is 381,180 triangles / 23,313,556 bytes with all foliage accessor bytes unchanged. They are Debug Mode appearance comparisons, not surveyed Hudson individual trees or default full-forest assets. The app loads and verifies every variant before departure and GPU preparation; switching selects prepared visibility only. The PWA file-size allowance is now 25MiB to include these local models, increasing the install/preload size by about 47.6MB; a successful precache build does not prove an offline experience.

See `polyhaven-pine.provenance.json` and `app/scripts/experiments/polyhaven-pine/` for the full source files/toolchain/output audit. Browser naturalness and rendering cost must be checked independently of successful asset preparation.
