# Peekskill source-backed building models

`buildings.glb` is the actual OSM2World 0.4.0 output from the archived 2026-10-09 Overpass extract. `provenance.json` preserves the converter version/archive checksum, query/input checksums, OSM IDs and height tags, textures and output bounds.

The complete file has 18 source buildings, 630 triangles and six embedded JPEG textures. The runtime imports only the **15 buildings with explicit OSM height tags** (586 triangles). It excludes Peekskill station `w285221615` and the two public-transport shelters `w1307801003/w1307801004`, whose generated 7.5m height/enclosed geometry is a converter default. Those objects keep their existing source-aware rendering and height provenance.

Runtime conversion maps the model's local Mercator coordinates/south-positive Z into the ride's Mercator/north-positive Z, reverses triangle winding for that reflection, and places each building at the current DEM elevation of its source footprint centre. It preserves metric heights. Ground vertex alignment is checked against the original footprint boundary, not a visual placement estimate; the current binary's maximum error is 0.0006442m. The finite-resolution DEM and flat per-building base do not establish surveyed foundation elevations.

The two PBR materials, `Plaster002` and `RoofingTiles010`, are generic OSM2World default-style materials, **not photographs or surveyed facade materials of these buildings**. Untagged roof form is also a converter assumption. [OSM2World](https://github.com/tordanik/OSM2World) code is MIT; its [default style](https://github.com/tordanik/OSM2World-default-style) is CC0. The map-derived model carries OpenStreetMap's ODbL attribution; the app links to the OSM copyright page.

The static imported and original-footprint comparison batches are loaded and GPU prepared before departure. The folded Debug Mode controls select their visibility without replacing chunks or loading another model. This is the first verified-data region of a wider building upgrade, not a claim that every corridor building has detailed geometry or a measured facade.

The original cloud GLB raw checksum and the GitHub Actions rebuild checksum differ. The diagnostic Actions run intentionally failed the exact-byte gate and retained its output. Its complete manifest differs only in the raw GLB checksum. Both checksums remain recorded; original JSON/BIN chunk comparison is pending. The runtime pins the actual delivered binary's SHA-256 and does not claim cross-environment byte reproducibility.
