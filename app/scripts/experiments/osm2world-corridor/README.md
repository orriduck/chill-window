# Source-height Hudson building recipe

The checked-in runtime bundle is the actual successful [Actions run 38045813068](https://github.com/orriduck/chill-window/actions/runs/38045813068)
at source revision `e3b050c`, inspected on 2026-10-10. Its pinned inputs and
measured audit are documented in `app/public/models/osm2world/hudson/README.md`.
The runtime catalog includes only corridor tiles; controls are kept in the
source artifact for research and are not packaged.

## Cloud conversion and independent geometry verification

Run conversion only in a cloud runner. `prepare.py` requires GDAL/OGR Python
bindings and the official OSM2World 0.4.0 Java release. It selects intact source
footprints intersecting the 1,200 m route corridor, groups them into occupied
256 m EPSG:26918 tiles, passes source-known metric heights, and extracts shared
content-addressed textures. It retains original tags/properties and transport
ID bindings in per-tile manifests; absent source heights are never guessed.

Official release: <https://osm2world.org/download/files/0.4.0/OSM2World-0.4.0-bin.zip>.
Release archive SHA-256:
`c05b37920d29c26710a06e30c170ca62e5e8ea653cccbbb3243dfc7e5d20b899`.
Converter license MIT; [default style](https://github.com/tordanik/OSM2World-default-style)
license CC0 1.0. Retained OSM/Overture data remains attributed as described in
the runtime README and pinned source metadata.

From the repository root in the cloud runner:

```sh
python3 app/scripts/experiments/osm2world-corridor/prepare.py \
  --osm2world "$OSM2WORLD_BIN" --tiles all --output "$BUILDING_BATCH_DIR"
python3 app/scripts/experiments/osm2world-corridor/prepare-controls.py \
  --osm2world "$OSM2WORLD_BIN" --output "$BUILDING_BATCH_DIR/controls"
python3 app/scripts/experiments/osm2world-corridor/verify-source-geometry.py \
  --root "$BUILDING_BATCH_DIR"
```

The independent verifier reads actual POSITION accessors, compares structural
ground vertices with original source polygon boundaries including holes, and
compares output heights with source heights. It reports window appearance planes
separately and explicitly audits open roofs. The full audit must have
`passed: true`, `errors: []`, 415 tiles and 5,853 buildings before packaging;
`reports/converter-log-audit.json` must also contain an empty error list.

## Reproducible standard-library packaging

Download and extract the successful Actions source artifact. Packaging requires
only Python's standard library and performs light metadata/checksum validation
and copying; it does not run the converter or reprocess meshes.

```sh
python3 app/scripts/experiments/osm2world-corridor/package-runtime.py \
  --source "$BUILDING_BATCH_DIR"
python3 app/scripts/experiments/osm2world-corridor/package-runtime.py \
  --source "$BUILDING_BATCH_DIR" --verify-only
```

For a new source batch, pass its actual `--source-run` URL and
`--source-revision`. The packaging contract remains 415 tiles and 5,853 exact
source-height records; changes to the selection require an explicit recipe and
consumer contract update.

The script compares input and output sizes/hashes with actual manifests,
compares GLB `osmId` node extras with source records, verifies exact source
heights/statuses against the pinned overlay and input XML, and checks all image
URI/hash/size bindings. Each runtime origin comes from its actual manifest and
must match the geographic extrema midpoint of the checksum-verified OSM input;
the expected conversion command has no origin override.

It copies only `tile-*/buildings.glb` and referenced `textures/` unchanged, then
writes a compact `catalog.json`, the source audit, and path-free provenance.
Full original source-record sidecars remain in the source artifact. It also
generates `GeoCorridorBuildingRecords.ts` with all 5,853 source IDs, the catalog
URL, total and catalog SHA-256. `--verify-only` verifies that existing packaged
bytes and generated metadata still match the source artifact.
