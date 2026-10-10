# EZ-Tree Ash/Oak static asset comparison

This is a pinned, offline export experiment using Dan Greenheck's EZ-Tree. It
contains static GLB renderings of the author's built-in Ash Large and Oak Large
presets at LOD0/1/2, with the LOD meshes generated from one shared skeleton per
preset. The models are uniformly scaled to 20 m for a controlled presentation
comparison. EZ-Tree presets do not define physical units or claim local Hudson
tree measurements. These assets are not evidence that Ash or Oak species were
surveyed at the rendered positions.

The library and bundled leaf textures are covered by the upstream MIT license.
The tree bark maps are AmbientCG Bark001, whose upstream notice records CC0
1.0. Keep the upstream MIT copyright notice and the AmbientCG credit URL when
redistributing this bundle. The manifest records source commit, hashes,
materials, texture sizes, and triangle counts.

## Rebuild

Requirements: Git, curl, Node.js 24, Python 3, and (for the preview renders)
Blender 4.0 or later. No npm/npx package install is used: the exact Three.js
r167 ESM build is fetched from its official GitHub source.

```sh
./rebuild-assets.sh
```

The script clones EZ-Tree at commit
`dcf309bd86bd521083d9c70f01f2de45fdc7c457`, verifies the two preset JSON files
and source textures against `manifest.json`, makes raw same-skeleton geometry,
and writes static GLB LODs under `glb/`. It does not add, move, or generate
geographic locations. `render_compare.py` renders the offline LOD comparison
images and is invoked by the rebuild script if Blender is present.

The GLBs have real embedded alpha PNG foliage and AmbientCG PBR bark textures.
This is a visual candidate only. It has not been integrated into Chill Window,
tested in the app's renderer, or validated as a local tree species survey.
