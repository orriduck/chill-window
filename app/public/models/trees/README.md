# Close-range tree model candidates

Both processed GLBs are CC0 derivatives of public Innerscene models. Complete source binaries, pinned conversion settings, and SHA-256 values are retained under `app/scripts/tree-assets/` and the adjacent `.provenance.json` files.

- `mature-scots-pine-lod.glb`: original 18m Scots pine; 54,318 source triangles reduced to 6,588; two 64×64 embedded base-color images. The source species is not asserted as a locally surveyed/native Hudson Valley tree. Do not replace all mapped woodland with pine.
- `oak-street-tree-lod.glb`: the source-described oak street-tree form is about 8.6m overall; 213,372 source triangles reduced to 10,668. It has four authored base-color materials and leaf mesh geometry, with no image textures. Keep it at authored scale; do not enlarge it into a mature forest tree.

Rebuild either asset with `python3 app/scripts/prepare-close-tree.py pine|oak --cli /path/to/gltf-transform`. The CLI is pinned to `@gltf-transform/cli@4.5.1` by the default npx command.

The independent `geography/GeoCloseTrees.ts` helper consumes placements with an explicit asset key. It does not infer real species or tree locations from NLCD/OSM. The root integration must decide which visual samples are appropriate, prepare assets before the scene is marked ready, and compare the close 3D layer with the existing far forest patches in cloud browser review.
