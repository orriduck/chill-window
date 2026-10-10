# Hudson source-height building tiles

This package contains the **actual successful** [Actions run 38045813068](https://github.com/orriduck/chill-window/actions/runs/38045813068)
at source revision `e3b050c`, inspected on 2026-10-10. It contains 415 unchanged
OSM2World GLBs (25,160,336 bytes) and 16 unchanged content-addressed shared images
(4,984,364 bytes). Out-of-corridor controls are not included.

`catalog.json` has 5,853 exact source/node bindings: 3,563 `source_tag` heights,
2,290 `source_estimate` heights, and four open roofs. Each model and image carries
its byte count and SHA-256. The generated engine record module separately pins
the catalog SHA-256:
`7d45e8588ea45b130766ae79b60f463ab7764a464023dc58e7e118f0a8390919`.
The source world SHA-256 is
`c4a2eaea1d1ffc3d1f9c346dcceb812f10a4efb9755da146d4c18249002393ec`;
the source buildings overlay SHA-256 is
`0d5bd68c040b42f99138fbdb768167ef22e8c48b5442fe0bf7d889f7347bd54f`.

Tile `origin` is `[longitude, latitude]`, the converter input's exact geographic
extrema midpoint recorded in its manifest and checked against its OSM XML nodes.
It is not the world origin or UTM tile corner. OSM2World uses its local metric
Mercator projection, scaled by the cosine of origin latitude, with X east, Y up,
and Z south. For example, `tile--1-43/buildings.glb` uses
`[-73.9772509, 41.3391481]`. Relative GLB image URIs remain `../textures/...`.

`source-geometry-verification.json` is the full successful independent audit:
415 tiles, 5,853 objects and 114,357 structural ground vertices; maximum source
boundary error 0.000700 m and maximum height error 0.000051 m, with no errors.
Window appearance planes are reported separately (315 ground vertices and
maximum 0.050571 m offset). Four `building=roof` records have no walls down to
ground; their approximately 0.31 m thickness is a converter appearance proxy.
`converter-log-audit.json` records the empty converter error list.

`provenance.json` retains the actual aggregate audit, source response/report
hashes, manifest-set hash, source links, source revision, selection rules, and
license metadata. The Actions source artifact retains all original per-tile
OSM XML, converter logs, full source records/tags, manifests and reports.
Packaging validates every source/output checksum, every output node binding,
all image references, source heights against the pinned overlay, and every
tile origin before copying assets. There are no guessed-height replacements.
Missing-height and excluded shelter records continue to live in the source
overlay and are absent from this model catalog.

## Attribution and appearance limitations

- © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
  [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Original OSM geometry
  and tags are retained in the checked-in source overlay.
- [Overture Maps Buildings](https://docs.overturemaps.org/guides/buildings/),
  release `2026-09-23.1`, source metadata identifies ODbL 1.0, including upstream
  OpenStreetMap and Microsoft ML Buildings records. Source response hashes and
  original release partitions are recorded in `provenance.json`.
- [OSM2World 0.4.0](https://osm2world.org/), MIT;
  [source and license](https://github.com/tordanik/OSM2World).
- [OSM2World default style](https://github.com/tordanik/OSM2World-default-style),
  CC0 1.0. Shared roofing, plaster and window images are converter style assets.

Source-tag heights are source attributes; source estimates remain upstream
model estimates, not surveys. Untagged facade/roof details and generic materials
are style proxies, not observed local appearances. Geometry acceptance does
not establish browser visual acceptance.

Reproduce with `app/scripts/experiments/osm2world-corridor/package-runtime.py`;
the recipe README describes cloud conversion and standard-library packaging.
