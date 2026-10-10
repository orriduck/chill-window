# Fixed EZ-Tree eight-view impostors

The source mesh is the already-pinned EZ-Tree Ash Large / Oak Large LOD0 geometry, decoded from `raw/*-lod0.json`; no GLB importer, random generation, or geographic placement is used. Blender reuses the mesh unchanged for all eight yaws at 45-degree increments. It uses the existing EZ-Tree leaf PNG and AmbientCG Bark001 color, normal, and roughness textures. Keep the EZ-Tree MIT notice and AmbientCG Bark001 CC0 attribution.

The source presets have no measured physical units. These meshes are uniformly presented at a 20m vertical extent. They are tree-shape appearance proxies only and do not claim Hudson species or tree locations.

## Rebuild

Requirements: run the pinned `./rebuild-assets.sh` first; Blender 4.0+ and Python 3 with Pillow are then required. `rebuild-impostors.sh` renders 16 transparent 512×512 RGBA PNG frames and makes two labeled contact sheets over a neutral checkerboard. The contact sheets are review-only and are not part of the transparent frames.

```sh
./rebuild-assets.sh
./rebuild-impostors.sh
```

The fixed orthographic camera uses the same 22m square world bounds, 80m camera distance, target Z=10.5m, 48 Eevee samples, and three fixed area lights for every tree and azimuth. Root point `(0,0,0)` projects to about `(256,500.36)` pixels, near the image bottom. Each frame records root pixel/UV and the projected actual mesh bounds in pixel and normalized UV coordinates. The global manifest records source and scaled model bounds in metres, preset seeds, source hashes, camera setup, and every rendered frame SHA-256.

Transparent RGBA PNGs are the intended output. Contact-sheet checkerboard compositing is for visual review only; neither the contact-sheet pixels nor the model-placement metadata describe local ground truth.
