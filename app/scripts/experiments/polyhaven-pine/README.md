# Poly Haven Pine Tree 01 native geometry experiment

These complete scripts were run in the existing cloud task using Blender 4.4.3. They fetch the official CC0 `.blend` and its linked source textures, inspect the author's LODs, export tree A with its source dimensions and dedicated foliage alpha, and compact opaque images without changing mesh/accessor buffer-view bytes.

The actual `.blend` contains LOD0/1/2 and no LOD3/4. Native tree A LOD2 has 416,451 triangles, including 345,915 foliage triangles, and measures approximately 7.60 × 8.30 × 20.40m. It is a source appearance comparison candidate, not a default full-forest model or surveyed local tree. Browser appearance and rendering cost have not yet been checked.

An earlier 25k whole-mesh reduction is not the accepted native export: reducing leaves merely to hit a polygon budget risks repeating the sparse-canopy failure. The cloud task continues checking a reduction that preserves foliage structure. Tree Small 02 (4.6m, Burkea africana) and Jacaranda were also inspected and are not labelled as mature Hudson species.

Heavy downloads/export belong in GitHub Actions or the cloud task. The source checksum manifest and pinned Blender bootstrap still need to be transferred before an Actions rebuild is dispatched. Do not execute the heavy export on the user's desktop.

Sources: [Pine Tree 01](https://polyhaven.com/a/pine_tree_01), [official files API](https://api.polyhaven.com/files/pine_tree_01), [CC0 license](https://polyhaven.com/license).
