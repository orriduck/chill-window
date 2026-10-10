# OSM2World Peekskill sample

This is an offline converter experiment over a pinned real OpenStreetMap snapshot near Peekskill station. It does not replace Chill Window's source-aware height/structure policy.

The original cloud and Actions outputs have different raw GLB hashes, but an independent comparison of all 18 source-keyed objects / 36 primitives matches exactly for accessor element bytes (positions, normals, UVs and indices) and material names: semantic SHA-256 `a04a18fad2b7eaee14659d71bffaafde3f24ccbb00e5aca0b8d92db3ccdd2bb3`, 22,109 normalized JSON bytes. All six embedded image hashes and the full source-record manifest also match. `verify-semantic-output.py` gates this mesh content and pins the two observed raw binaries; the Actions workflow additionally pins the actual Actions raw hash. This is not a claim of cross-environment byte reproducibility.

## Rebuild

1. Download the official OSM2World 0.4.0 binary archive from <https://osm2world.org/download/>. The release zip is 452,089,567 bytes; its SHA-256 is in `manifest.json`.
2. Unpack it and run:

   ```sh
   python3 prepare.py --osm2world /path/to/OSM2World-0.4.0/osm2world.sh
   ```

   The script filters the archived Overpass XML to the 18 building ways and 209 required source nodes, then runs the documented CLI with `--lod=2`. It verifies that the exported GLB retains the source OSM IDs in `node.extras.osmId`, and records its SHA, meshes, triangles, material names, embedded-image hashes, feature tags, and vertical bounds in `manifest.json`.

3. To re-check the checked-in GLB and regenerate its manifest without rerunning the converter:

   ```sh
   python3 prepare.py --verify-only
   ```

The source query, exact response, filtered OSM input, GLB and manifest are retained together. The query response's OSM base timestamp is `2026-10-09T23:38:06Z`; the data is © OpenStreetMap contributors, ODbL 1.0.

## What the sample shows

The exported model is 3,281,376 bytes with 36 meshes/primitives, 630 triangles, 2 materials (`Plaster002`, `RoofingTiles010`) and six embedded JPEG maps. They are generic images from OSM2World's shipped CC0 default style, not local facade photos. GLB nodes preserve all 18 way IDs.

Fifteen OSM objects have `height` tags; three do not have either `height` or `building:levels`: Peekskill station (`way/285221615`) and the two public transport shelters (`way/1307801003`, `way/1307801004`). In this exact OSM2World 0.4.0 export, all three are modeled from y=0 to y=7.5 m. Those 7.5 m are converter defaults. They are not source measurements. In particular, the source tags identify the two shelter ways as `amenity=shelter`, `shelter_type=public_transport`; the generic export makes building geometry for them and must not be read as proof of full-height enclosing walls. The existing source-tag-aware open-shelter representation remains the faithful baseline.

The local metric model is centered at the midpoint of the retained OSM node bounds (longitude -73.9314607, latitude 41.2843073): x is east-positive, y is up, and z is south-positive. Units are metres; there is no global CRS transform stored in the GLB. No DEM is supplied, so the ground plane is y=0. Tagged `ele` values do not anchor the model to real terrain.

## First conversion attempt

An initial attempt converted the full small-area response including roads. OSM2World logged a repeated-vertex triangulation error at a road junction while returning exit code 0 and still writing a GLB. The exact short log is kept as `combined-road-input-failure.log`. The successful sample therefore filters to building objects for a clean building-geometry comparison; the raw OSM response remains available so the filter is reproducible.

## Upstream sources

- OSM2World 0.4.0 release and CLI: <https://osm2world.org/download/> and <https://osm2world.org/blog/2025/01/21/release-0.4.0/>
- OSM2World source and MIT license: <https://github.com/tordanik/OSM2World>
- Shipped default-style source and CC0 license: <https://github.com/tordanik/OSM2World-default-style>
- OSM contributors and ODbL: <https://www.openstreetmap.org/copyright>
