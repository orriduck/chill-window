# EZ-Tree Ash/Oak static asset comparison

The GitHub Actions preparation job runs `rebuild-assets.sh` and
`verify-report.py` to export and independently check all six static GLBs.
These recovered scripts do not include a Blender preview renderer. Browser
visual acceptance is a separate step in Chill Window.

The source-scale reference height is 20m for LOD0. Lower detail levels retain
the author's enlarged remaining leaf cards, so their actual outer crown
height can differ (Ash LOD1 is 20.3969m in the first Actions output). The report
records actual extents; none of these dimensions are a Hudson measurement.

The GLB writer uses the standard `metallicRoughnessTexture` field for the
unchanged grayscale Bark001 roughness image. The verifier reconstructs the
original cloud JSON and checks its exact original hash, preserving the full
geometry and embedded-image content despite that material-key correction.

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

Requirements: Git, curl, Node.js 22, Python 3. No npm/npx package install is
used: the exact Three.js
r167 ESM build is fetched from its official GitHub source.

```sh
bash rebuild-assets.sh
python3 verify-report.py
```

The script clones EZ-Tree at commit
`dcf309bd86bd521083d9c70f01f2de45fdc7c457`, verifies the two preset JSON files
and pinned source textures, makes raw same-skeleton geometry,
and writes static GLB LODs under `glb/`. It does not add, move, or generate
geographic locations. `cloud-manifest.json` preserves the original cloud
observations. `verify-report.py` writes the actual rebuilt report; the checked-in
`observed-report.json` records the independently downloaded Actions output.

The GLBs have real embedded alpha PNG foliage and AmbientCG PBR bark textures.
This is a visual candidate only. Four LOD1/2 files are being evaluated in
Chill Window's folded source-model controls. They have not yet replaced the
primary forest or been validated as local tree species surveys.
