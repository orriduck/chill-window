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

Follow-up after actual c0b53bf / Actions 38062684232 failed: preserve the failed
polling report. Add a read-only synchronous first-ready proof from actual renderer
fence completion, current49 gpuReady flags and pending0 before departure. Home's
existing callback records actual zero clock refs. Cloud QA binds that event to the
current world and held route; only then may later forward GPU work coexist with
clock progress while current displayed49 still holds. Do not change runtime
readiness/speed/clock behavior to hide a polling race. Offline independent SHA
checks and workflow bounds remain unchanged; new actual cloud evidence is pending.
Independently cap the first eligible focus/segment/dwell delta by elapsed time
since the exact initial-ready timestamp, excluding the final preparation tail
when readiness changes mid-RAF. Verify that retained worlds, zero speed, pause
and inspection retain their previous permissions.

Follow-up after actual c2fd325 / [Actions 38063997640](https://github.com/orriduck/chill-window/actions/runs/38063997640)
failed: the downloaded health report passed the synchronous initial preparation
proof, source/transport counts and actual movement, with no page errors. Native
`Pause journey` click timed out because the neighboring `Mute sound` SVG
intercepted pointer events. No PNG or SW/offline evidence was produced; this is
not appearance acceptance. Keep each transparent DOM button at its existing
painted HUD projection: remove viewport minimum-size inflation, reset intrinsic
padding/border sizing, clip overflow and disable descendant pointer events.
Record actual pause bounds and center hit target before the unchanged native
click. Require the Resume label, active unfrozen scene callbacks, and unchanged
actual route/focus/segment readouts over a one-second hold before the existing
strict GPU-ready PNG gate. Initial-proof, held-pack and independent offline pins
remain unchanged. The corrected native click, PNG and SW/offline checks still
require a new cloud run; no local browser/GPU or appearance acceptance is claimed.

Follow-up after actual f325499 / [Actions 38064980308](https://github.com/orriduck/chill-window/actions/runs/38064980308)
failed: the corrected CSS passed the actual center hit test (`Pause journey`),
with zero computed minimum dimensions and border. The projected HUD still moves
with camera sway, so the locator's stability requirement timed out. No PNG or
actual SW/offline evidence was produced. Keep the painted HUD and CSS unchanged;
QA now measures the current pause center immediately before one browser-native
mouse click, requires that center to hit the actual Pause button, and records a
read-only document `pointerdown` observer's trusted flag, button label and
coordinates. Fail if the trusted pointer misses Pause or Resume is not observed.
The existing unfrozen one-second settle and one-second route/clock hold, strict
GPU-ready frozen PNG, held-pack/source-count checks and independent SW/offline
pins remain intact. Actual native pointer verification is pending a new cloud run.
