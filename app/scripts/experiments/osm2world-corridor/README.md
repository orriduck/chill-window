# Hudson 1.2 km source-height building conversion

This is a reproducible offline experiment over the committed real route and
building overlay. It writes tiled OSM2World 0.4.0 GLBs and source sidecars; it
does not change the app renderer or replace the source-aware footprint layer.

## Verified inputs

- `app/public/geodata/hudson/world.json`, SHA-256
  `c4a2eaea1d1ffc3d1f9c346dcceb812f10a4efb9755da146d4c18249002393ec`.
- `app/public/geodata/hudson/buildings.json`, whose `baseWorldSha256` must match
  the world above. The script checks this relation before any conversion.
- Overlay source is Overture release `2026-09-23.1` plus retained OSM geometry
  and tags. Source-response hashes are included in the generated conversion plan.
- OSM2World 0.4.0 is MIT, release archive:
  <https://osm2world.org/download/files/0.4.0/OSM2World-0.4.0-bin.zip>.
  The verified archive is 452,089,567 bytes, SHA-256
  `c05b37920d29c26710a06e30c170ca62e5e8ea653cccbbb3243dfc7e5d20b899`.
- OSM2World default style is CC0:
  <https://github.com/tordanik/OSM2World-default-style>.
  Its roofing/plaster/window appearances are converter style, not site survey
  imagery. The OSM data remains ODbL 1.0 and requires attribution.

## Rebuild

Requires Python 3 with GDAL/OGR bindings and Java. For example on Ubuntu:

```sh
sudo apt-get update
sudo apt-get install -y gdal-bin python3-gdal default-jre-headless unzip
curl -L https://osm2world.org/download/files/0.4.0/OSM2World-0.4.0-bin.zip -o /tmp/OSM2World-bin.zip
echo 'c05b37920d29c26710a06e30c170ca62e5e8ea653cccbbb3243dfc7e5d20b899  /tmp/OSM2World-bin.zip' | sha256sum -c -
unzip -q /tmp/OSM2World-bin.zip -d /tmp/osm2world-040
cd app
/usr/bin/python3 scripts/experiments/osm2world-corridor/prepare.py
/usr/bin/python3 scripts/experiments/osm2world-corridor/prepare.py \
  --osm2world /tmp/osm2world-040/osm2world.sh --tiles all \
  --output /tmp/hudson-osm2world-corridor
/usr/bin/python3 scripts/experiments/osm2world-corridor/prepare-controls.py \
  --osm2world /tmp/osm2world-040/osm2world.sh \
  --output /tmp/hudson-osm2world-corridor/controls
```

The first invocation is plan-only. For a sample build, replace `all` with tile
keys such as `7,7 19,68 15,67`. The complete conversion makes one converter
input for each occupied 256 m EPSG:26918 tile. Features are bucketed by their
polygon centroid (whole source polygon retained, never clipped); features that
intersect the 1,200 m route buffer are included. A building part follows its
parent's tile when both are represented.

Each tile GLB references deduplicated, content-addressed image files in the
sibling `textures/` directory. Relative texture URIs keep each GLB loadable
with the shared texture bundle and avoid embedding the same several MB of style
images in every tile. Each tile manifest records both the original OSM2World
GLB hash/size and the compact final GLB hash/size plus every image URI/hash/size.

## Data and geometry rules

- Only `source_tag` and explicit `source_estimate` metric heights are extruded.
  A source estimate stays marked as an upstream model estimate in each tile
  manifest. `floors_only` and `missing` records are not assigned a height.
- Original source tags, Overture properties, source dataset/record ID, GERS ID,
  parent ID, and height status are retained in each tile manifest. Stable
  synthetic OSM IDs used for Overture-only geometry map back to those IDs.
- Existing OSM footprints and Overture footprint components/holes feed the
  generated OSM input. The input XML, converter logs, GLB, and per-tile source
  map are retained together.
- Roof shape/material/color, facade material/color, roof height/orientation,
  and min-height are mapped only when the upstream record actually has those
  values. Converter defaults remain visibly marked as style-derived in this
  experiment; they are not stated as measured local appearances.
- Tagged shelters are excluded from solid GLBs even when an estimated or tagged
  height exists. Their IDs and source tags remain in the exclusion catalog; the
  original footprint remains available in `buildings.json` for outline-only
  display. Missing-height buildings and shelters are not converted into walls.
- The 1.2 km buffer currently contains one building part, but it has no source
  height, so it remains a footprint only. The three parts in the overlay and
  their parent IDs are preserved in the plan/source inputs. No source-height
  part inside this buffer is claimed as converted.
- Verified route-wide selection: 6,825 footprint components intersect the
  1,200 m buffer; 3,566 carry `source_tag` height and 2,291 carry explicitly
  marked `source_estimate` height. Fifteen shelter components are excluded from
  solid models. The final batch has 5,853 converted features in 415 occupied
  tiles, 104,537 triangles and 11,715 meshes. Shared-image extraction reduces
  the converter's 1,343,103,224 embedded-image GLB bytes to 25,160,588 tile GLB
  bytes plus 4,984,364 bytes of 16 shared images.
- In this exact corridor, the only `roof:shape` / `roof_shape` component is an
  open shelter with missing height, and it is excluded. No source-height
  building part lies in the buffer; the one part intersecting it is
  `5ea5aa07-0f36-3f23-8ac0-7d01578a1fa7`, status `missing`.
- To test the rare OSM2World cases without silently widening the production
  area, `prepare-controls.py` converts two clearly marked out-of-corridor
  controls: the tar-paper-roof church `overture/b00509c4-82e0-47d0-8708-cc9c8465530b`
  at 1,335.587 m, and the height/min-height part
  `7a1a4b39-d3ec-3939-a05a-e272ca1bbb3a` at 1,254.940 m. The former keeps the
  source color `#778899` and a flat, tagged `tar_paper` PBR appearance proxy;
  this is a tag-driven representation, not a roof photo. The latter is represented
  as child geometry under its parent OSM2World node; the part record stays in
  the sidecar because OSM2World does not emit a separate GLB node ID for it.

This experiment generates georeferenced sidecars and local-coordinate GLBs for
review. It does not assert that generic windows, roof geometry or materials are
observed from local photos; roof/height gaps and lack of facade photography
remain explicit limitations.

The reference run reports are under `reports/`: `corridor-batch-plan.json`
contains every tile hash, size, material list, bounds and per-source vertical
comparison; `source-id-map.json` maps every output node ID to the exact OSM/GERS
record and height provenance; `sample-validation.json` records checksum,
source-geometry and shelter-exclusion checks; and `out-of-corridor-controls.json`
records the two separately scoped control cases. Reference SHA-256 values are:
plan `4a15009333f9c0ca96456271273614a95096923a07f65c8c2f290ecedbcdc160`,
source map `7ace84860732c1dfad6a44238256592d91d087213a23ba55dddd63df42ae1deb`,
validation `d9596dfd098dd388dd5442874fd9e8ee630b70a43ab01b927f525573cabcef35`,
and controls `1e2d485b695ea5d61092cede677b6345f3cdf30f73af36d4bca22d5a2df6a5a7`.

Recovery status: the complete three recipe sources were recovered from the
cloud task's untruncated file changes. The large original reports and binary
outputs were not recovered through chat. Their hashes above are the original
cloud observations, not a claim that those files are checked in here. The
`Prepare source-height Hudson building corridor` Actions workflow independently
rebuilds the same pinned inputs and uploads the actual thin GLBs, shared images,
source sidecars, logs and reports. These outputs need inspection before runtime
integration or visual acceptance.
