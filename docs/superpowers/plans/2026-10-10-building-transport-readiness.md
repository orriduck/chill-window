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

Follow-up after actual 40bad72 / [Actions 38065590059](https://github.com/orriduck/chill-window/actions/runs/38065590059)
failed: the native mouse pointer reached Pause with a trusted event and Resume
was observed. Actual route/focus/segment readouts held exactly, but the one-second
sample recorded 369 to 369 callbacks, both unfrozen with two callbacks queued,
while the current forward GPU batch remained at its fence. This run produced no
PNG or SW/offline evidence. QA now waits up to 60 seconds, polling every 100ms,
for an actual callback count increase after the before-hold sample, then retains
the existing one-second wall-clock hold and exact route/clock equality checks.
Unfrozen callback progress, trusted native Pause/Resume, strict current49/GPU-ready
frozen PNG, held-pack/source-count and independent SW/offline gates remain intact.
Only script syntax and diff scope are checked locally; a new cloud run is required.


Follow-up after actual 8fece7e / [Actions 38066116720](https://github.com/orriduck/chill-window/actions/runs/38066116720)
failed, checked 2026-10-10: downloaded actual health evidence passed the held-pack
route/zero-clock checks, synchronous initial current49/GPU-ready proof, all
5,853 buildings / 415 verified and parsed slices / 16 shared textures, one pack
request / zero standalone GLBs, actual movement, and trusted native Pause/Resume.
The unfrozen pause hold observed real callback progress and unchanged route and
both clocks. A real prepared paused PNG was produced (165,605 bytes); callbacks
held at 385 during its strict GPU-ready freeze and resumed unfrozen afterward.
Root visually inspected that actual PNG: white building masses and grey ground
remain, so appearance is not accepted. Global page errors were empty. The run
then timed out at the old 60-second controller wait after reload, with stage
`service-worker-install`; actual SW cache membership and independent offline
hash checks were not reached. This remains a partial failed run.

The old QA condition only checked existence of `registration.active`, which may
still have state `activating`; this is a confirmed script lifecycle gap, not a
confirmed cause of that run's timeout. [Playwright's activation guidance](https://playwright.dev/docs/service-workers#accessing-service-workers-and-waiting-for-activation)
and the [Service Workers registration specification](https://www.w3.org/TR/service-workers/#service-worker-registration-active)
were checked 2026-10-10. The app registers on page load; the actual generated
worker already uses skipWaiting, clientsClaim and precaching. The reload also
mounts the existing 3D scene, so a long SwiftShader frame delaying the old default
RAF polling is another hypothesis, not an observed cause.

Only cloud QA changes: install an early read-only lifecycle observer, recording
controllerchange, discovered registration/update/state transitions, scope and
worker script URLs/states, page origin/MIME and SW script response status/MIME.
Keep snapshots on the initial page, real activation, any normal reload, control
and failure; failure diagnostics enumerate existing cache keys/counts without
fetching or adding assets. Record SW-owned request failures and contextual
console/page errors while retaining the global page-error gate. Wait for actual
`activated` state first, and require an actual activated controller bound to the
active script URL. Reload normally only if still uncontrolled after activation.
Activation, optional reload and controller confirmation share the existing
240-second deadline, with 200ms polling independent of scene RAF. Never register,
claim, force control or seed caches in QA. First-context Pause/PNG and exact
independent pack/index/catalog SHA plus membership 16 textures / 9 trees / zero
standalone GLBs remain unchanged. Local validation is syntax, focused JavaScript
semantics and diff scope only; no local browser/GPU run, new cloud runtime pass,
SW/offline pass or appearance acceptance is claimed.
