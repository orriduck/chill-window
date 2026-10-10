# Poly Haven Pine Tree 01 native geometry experiment

These complete scripts were run in the existing cloud task using Blender 4.4.3. They fetch the official CC0 `.blend` and its linked source textures, inspect the author's LODs, export tree A with its source dimensions and dedicated foliage alpha, and compact opaque images without changing mesh/accessor buffer-view bytes.

The actual `.blend` contains LOD0/1/2 and no LOD3/4. Native tree A LOD2 has 416,451 triangles, including 345,915 foliage triangles, and measures approximately 7.60 × 8.30 × 20.40m. It is a source appearance comparison candidate, not a default full-forest model or surveyed local tree. Browser appearance and rendering cost have not yet been checked.

An earlier 25k whole-mesh reduction is not the accepted native export: reducing leaves merely to hit a polygon budget risks repeating the sparse-canopy failure. The conservative variant reduces only the opaque branches to 381,180 triangles; all 345,915 foliage triangles remain unchanged. Tree Small 02 (4.6m, Burkea africana) and Jacaranda were also inspected and are not labelled as mature Hudson species.

Heavy downloads/export belong in GitHub Actions or the cloud task. The exact source SHA-256/size manifest and official Blender 4.4.3 archive checksums are now preserved beside these scripts. The downloader checks the pinned actual source bytes as well as the current API checksums. Do not execute the heavy export on the user's desktop. The archived cloud native output checksum is provenance, not a claim that every Blender environment exports byte-identical GLB; inspect actual geometry and record each produced raw checksum.

Sources: [Pine Tree 01](https://polyhaven.com/a/pine_tree_01), [official files API](https://api.polyhaven.com/files/pine_tree_01), [CC0 license](https://polyhaven.com/license).

[Actions run38014443841](https://github.com/orriduck/chill-window/actions/runs/38014443841) successfully rebuilt both variants from the pinned sources. Root downloaded the actual artifact and independently rechecked both delivered sizes/SHA-256; these match the prior cloud outputs. `cloud-delivery-report.json` preserves output checksums, image hashes and source-keyed foliage geometry hash. The leaf geometry is equal and the dedicated alpha remains embedded PNG/MASK. This proves preparation and transfer, not application appearance; browser visual inspection and runtime integration remain pending.
