# Building transport and readiness QA

This follow-up candidate is uncommitted in the owned review checkout, based on
`c0b53bff2dd56f5161566350365cfd5fe31ca72d`. No local browser/GPU run, commit,
publication or new cloud dispatch is performed by this follow-up implementation.
The independent terrain review and its branch/workflow are untouched.

## Actual first cloud attempt and follow-up

[Actions 38062684232](https://github.com/orriduck/chill-window/actions/runs/38062684232)
ran `c0b53bf` and **failed**. The downloaded actual health report has 108 samples,
no page errors, no PNG, and did not reach the SW-enabled/offline context. The held
pack kept route position at 3123.283m and both clocks at zero. Every observed
initial fence sample has GPU completed=0 and focus/segment=0; the final poll has
ready/presentable=true, GPU completed=1, current coverage=49, but the next forward
tile is already compiling (pending GPU=1), with both clocks at 0.5s. The exact
failure and compact actual evidence are preserved in
[cloud-failure-c0b53bf.json](cloud-failure-c0b53bf.json).

Source ordering is warmup/upload/fence → mark actual chunks → first ready callback
→ queued departure → later RAF forward preparation/preload. This supports a
polling race: the 200ms observer can miss the initial idle moment and then
mistake later forward work for incomplete initial preparation. The old report
does not contain synchronous first-ready evidence, so this remains a failed
attempt and is not retroactively accepted.

The follow-up adds read-only initial evidence at that existing ready callback,
before departure: renderer sequence/idle/completed count, direct actual gpuReady
flags for all 49 current tiles, all-cache pending GPU count and unchanged route
position. Home synchronously adds the actual focus/segment refs, avoiding its
200ms HUD throttle, and emits a preparation event observed before app modules by
cloud QA. The event is bound to the current world's start timestamp and must show
zero clocks, idle/completed GPU, pending=0 and current=49/49. Existing runtime
readiness, speed and forward preparation behavior are not changed.

Only after observing that complete initial proof may QA accept a subsequent
forward GPU batch; the displayed current view must still be 49/49. Missing,
incomplete, stale-world or nonzero-clock initial proof still fails. The next real
cloud run must produce this evidence; local mocked observations cannot prove it.

A separate first-frame timing edge was found in Home: a RAF delta spanning the
final fence could include the not-yet-ready part of that interval. The clock
increment is now capped by seconds since the exact initial proof timestamp, on
the same performance timeline. For example, previous RAF 1000ms, readiness
1375ms and current RAF 1500ms charges 0.125s rather than 0.5s. Retained ready worlds
still charge their usual capped delta, independent of train speed; dwell, pause
and inspection permissions remain unchanged. A focused transition test checks
this boundary separately from the observation-race fix.

## Lightweight checks

Original candidate's 2026-10-10 checks: full source `--verify-only`, deterministic generation,
415 exact slices, targeted 20 tests in four files, changed-file ESLint,
TypeScript/Vite build, generated SW membership and script syntax all passed.
Exact sizes/hashes and pending checks are in [checks.json](checks.json). The build
keeps its existing large JS chunk warning. SW emits 79 entries / 75 unique URLs
because four existing icon entries also occur in `includeAssets`; the building
pack/index/catalog each occur exactly once. Unrelated icon configuration is kept.
The current follow-up passes seven targeted tests in two files (current GPU
coverage, mid-frame readiness and the existing journey cases), changed-file
ESLint, TypeScript/Vite build, generated SW audit, script syntax and narrow Node
event/proof cases. The original 20 tests were not needlessly repeated.

Run from the repository root:

```sh
python3 app/scripts/experiments/osm2world-corridor/package-runtime.py --source /path/to/successful-source-batch --verify-only
npm --prefix app run build
node app/scripts/check-building-precache.mjs
```

The full source packager retains all existing exact OSM origins, height/ID maps,
source geometry report, converter log and original GLB/texture checks. It also
checks all 415 pack slices against those original files and catalog SHA values.
Repeat packaging of the same successful source batch is deterministic. The
original catalog/provenance/record module and source files remain unchanged.

Targeted Vitest checks exercise original-byte preservation, corrupt pack/index,
range/URI/hash tampering, download abort, post-disposal parse completion and parse
error cleanup. They mock only the parser/image decoder for transport lifetime;
they do not prove actual browser GLTF parsing, visuals or GPU completion.
The journey test includes source preparation, GPU preparation, ready stationary
departure, manual pause, terrain inspection and later preparation failure.
Home reads the active ThreeCanvas control's local `worldReady && presentable`
each frame, rather than keeping a ready flag across journeys. The listener emits
false on effect mount, cleanup/unmount and errors. Starting another journey keeps
the same existing world; if that world is actually ready, its clocks may start.
Any renderer/world remount must complete its own preparation first.

## Bounded cloud QA recipe (pending)

The dedicated `.github/workflows/building-transport-review.yml` is dispatchable
after this candidate is selected and committed to the exact
`codex/building-transport-review` branch. It runs only for that branch (push or
manual dispatch), with a 25-minute job limit and a 1,200-second script limit.
The generic visual workflow has only an exact-branch skip added, so its old
415-request building capture cannot run on this candidate branch. No existing
capture bodies or terrain workflow are changed. The new job builds, checks actual
SW membership and prepares cloud Chromium/preview before running:

```sh
export CW_CLOUD_QA=1
export PW_MODULE_PATH="$RUNNER_TEMP/chill-playwright/node_modules/playwright"
export CW_CAPTURE_DIR="$RUNNER_TEMP/chill-building-transport"
export CW_CAPTURE_SHA="$GITHUB_SHA"
node app/scripts/capture-building-transport.cjs
```

Upload `building-transport-health.json` and the preview-server log even on
failure. The script records its 640×360 viewport and captures one paused ready
passenger PNG with the existing terrain capture's RAF freeze/resume contract.
It records actual PNG success/bytes and callback stability; failed/absent PNGs
remain failures. The artifact upload is limited to PNG/JSON/logs, with no model
or source asset bundles. The script has two independent contexts:

1. Block service workers; hold the **actual pack** request. Board before it is
   released, sample for six seconds and require position and focus/segment clocks
   to remain exactly unchanged while preparation time increases. Release it and
   require actual presentable state, GPU idle/completed fence, 49/49 current
   coverage, 415 verified/parsed slices, 5,853 objects, 16 decoded image Sources,
   exact model/texture totals, pack released, then real clock and train movement.
   Continue clock sampling until the synchronous first-ready proof of the complete
   presentable + GPU idle/completed + zero pending upload + exactly 49 current
   uploaded tiles gate, with actual focus/segment refs both zero and held route
   position unchanged. Progress without that proof fails, even if presentable is
   true. Later forward compile/upload is accepted only after this proof and with
   the currently displayed coverage still exactly 49. The paused PNG keeps its
   separate strict current GPU-idle/pending-zero/49 ready check.
   Record every actual Hudson asset request: one pack, zero standalone models,
   16 unique texture requests. Download/hash/parse/batch/whole-world/GPU durations
   come from the Debug datasets, not wall-clock guesses.
2. Create a fresh context with service workers enabled and no interception. Wait
   for installation/control and inspect actual CacheStorage entries for
   pack/index/catalog, zero Hudson standalone duplicates, 16 textures and nine
   tree GLBs. Go offline and fetch/hash pack/index/catalog through the active SW.
   Compare all three hashes independently to the fixed source record pins, and
   require exactly 25,160,336 pack bytes / 59,502 index bytes. Parse/cross-bind the
   index only after its own fixed SHA/byte check succeeds; downloaded index fields
   cannot supply their own expected hashes.
   This proves only building transport offline delivery; existing whole-world
   offline coverage is outside this check and must not be inferred.

The archived old direct-request run (38047928868) observed 415 model requests;
the failed `c0b53bf` report observed one pack, zero standalone model and 16 unique
texture request events. This partial request observation does not complete the
source-count/GPU/PNG/SW acceptance. Do not turn fewer HTTP requests into an
unsupported performance claim. SHA, decode, source validation, batching and GPU
preparation all still occur before departure.

Actual scene PNGs and human visual inspection remain pending until the new job
executes. The old cloud-visual-review inline building test still targets a
standalone GLB and expects 415 requests; it is skipped for this dedicated branch.
Its capture body must be adapted to the pack before using it elsewhere for this
candidate. The dedicated script records a real prepared passenger PNG but does
not claim comprehensive building comparisons, whole-route or terrain acceptance.
