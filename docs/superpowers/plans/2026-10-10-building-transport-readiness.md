# Building transport and real preparation gate

Approved bounded implementation in the owned review checkout, based on adea0fe.
No commit, push, deployment, local browser or local GPU run in this task.

1. Concatenate the catalog's 415 original GLBs, in catalog order, with no padding
   or byte edits. Generate a separate versioned index and pinned hashes. Preserve
   the original catalog, source provenance, standalone GLBs and 16 textures.
   Validate unique contiguous safe integer ranges, full coverage, catalog binding,
   and byte equality plus SHA for every original slice. The pack stays under 25MiB.
2. Fetch and hash the pack once. The existing four preparation workers copy/hash
   one slice on demand, then use the same GLTFLoader/shared-image manager with the
   original virtual tile directory. No standalone model fetch fallback. Release
   the pack after all parses and on abort/error/disposal.
3. Extend geographic Debug diagnostics before QA: transport requests/bytes,
   download/hash/parse/batch/whole-preparation/GPU timing and verified/parsed counts.
   Expose actual preparation state from ThreeCanvas to Home; hold both focus and
   segment clocks until the existing world.ready + GPU fence gate completes.
   Keep pause, terrain inspection and station semantics independent of speed.
4. Exclude only the 415 Hudson standalone GLBs from precache. Include pack,
   index and catalog; retain texture/tree precaching. Verify the emitted SW list.
5. Run lightweight source/pack, corruption, abort and clock-state checks plus
   TypeScript/Vite and targeted lint. Save a cloud-only QA recipe for held-pack
   startup, 49-tile/GPU fence, full asset counts, request comparison and SW-enabled
   offline checks. Do not claim browser, GPU or performance acceptance locally.
   Wire a dedicated exact-branch building-transport-review workflow, with a
   25-minute job / 1200-second script limit and always-upload PNG/JSON/logs only.
   Exclude just that branch from the generic old 415-model capture. One paused,
   actual-ready PNG uses the existing RAF freeze/resume contract.

References: current catalog/provenance and archived source batch in REFERENCES.md;
the transport does not change visual geometry/materials or add appearance claims.
