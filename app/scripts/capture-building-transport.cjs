// Cloud-only, bounded runtime evidence. Does not assert visual or hardware performance acceptance.
if (process.env.CW_CLOUD_QA !== '1') throw new Error('Run this capture only in the cloud QA job with CW_CLOUD_QA=1');
const { chromium } = require(process.env.PW_MODULE_PATH);
const fs = require('node:fs/promises');
const path = require('node:path');
const output = process.env.CW_CAPTURE_DIR;
const base = process.env.CW_QA_URL || 'http://127.0.0.1:4173/';
// Independent pins from GeoCorridorBuilding{Pack,}Records.ts and the delivered
// index byte audit. Downloaded index content never supplies its own trust root.
const fixedTransport = Object.freeze({
  packBytes: 25160336, indexBytes: 59502,
  packSha256: '4cd4c0b455ef3395e7fcfc0a5f27c0b115d5a3dc93a2d3c864bfb3c7cf719374',
  indexSha256: '5a616693fa4744f970408138dfff7ab739642e5e75125148509488ad2b8e3777',
  catalogSha256: '7d45e8588ea45b130766ae79b60f463ab7764a464023dc58e7e118f0a8390919',
});
const health = { commit: process.env.CW_CAPTURE_SHA, rendering: 'Chromium / SwiftShader',
  viewport: { width: 640, height: 360 },
  scope: 'Held building pack, actual clocks/train readiness, native pause click, source counts and separate SW-enabled building cache',
  passed: false, stage: 'starting', visualReviewRequired: true, states: [], errors: [], requests: [] };
let browser, context, releasePack;
const save = () => fs.writeFile(path.join(output, 'building-transport-health.json'), JSON.stringify(health, null, 2));
const fail = (condition, message) => { if (!condition) throw new Error(message); };
function installPreparationEvidenceObserver() {
  window.__buildingPreparationEvents = [];
  window.addEventListener('chill:preparation', event => {
    window.__buildingPreparationEvents.push(event.detail);
  });
}
function sampleUntilFullPreparationGate(heldRouteMetres) {
  const stream = document.querySelector('[aria-label="地理区块流式加载诊断"]');
  const clocks = document.querySelector('[data-journey-phase]');
  const coverage = document.querySelector('[aria-label="地形覆盖诊断"]')?.dataset.readyTiles;
  const pendingGpu = Number(/后续待上传 (\d+)/.exec(stream?.textContent ?? '')?.[1]);
  const gpuCompleted = Number(stream?.dataset.gpuCompleted);
  const events = window.__buildingPreparationEvents ?? [];
  const currentStart = events.findLast(event => event.phase === 'loading')?.startedAtMs;
  const initial = events.find(event => event.phase === 'ready' && event.startedAtMs === currentStart);
  const proof = initial?.initialReadyProof;
  const fullGate = initial?.presentable === true && Number.isFinite(currentStart) && proof?.startedAtMs === currentStart
    && proof.gpuPhase === 'idle' && Number.isSafeInteger(proof.gpuSequence) && proof.gpuSequence > 0
    && Number.isSafeInteger(proof.gpuCompleted) && proof.gpuCompleted > 0 && proof.pendingGpu === 0
    && proof.readyTiles === 49 && proof.totalTiles === 49 && proof.routeMetres === Number(heldRouteMetres)
    && Number.isFinite(proof.observedAtMs) && proof.observedAtMs >= currentStart && proof.observedAtMs <= initial.observedAtMs
    && initial.focusElapsedSeconds === 0 && initial.segmentElapsedSeconds === 0;
  const samples = window.__buildingClockGateSamples ??= [];
  const focus = Number(clocks?.dataset.focusElapsedSeconds), segment = Number(clocks?.dataset.segmentElapsedSeconds);
  if (samples.length < 1000) samples.push({ phase: stream?.dataset.preparationPhase, presentable: stream?.dataset.presentable,
    gpuPhase: stream?.dataset.gpuPhase, gpuCompleted, pendingGpu, coverage, fullGate, focus, segment });
  if (!fullGate && (initial || focus !== 0 || segment !== 0)) return { failed: true, samples, initial, events };
  if (stream?.dataset.preparationPhase === 'error') return { failed: true, samples, initial, events };
  // Later forward-tile uploads may already be in flight by this poll. They are
  // allowed only after the synchronously observed initial full gate, while the
  // currently displayed view must still have all 49 uploaded tiles.
  if (fullGate) {
    // The event precedes the first scene/HUD RAF. Wait for its display readout
    // acknowledgement rather than treating the previous frame's 0 mask as the
    // uploaded current-view count captured synchronously in the proof.
    if (stream?.dataset.presentable !== 'true') return false;
    return { failed: coverage !== '49', samples, initial, events };
  }
  return false;
}
async function verifyOfflineBuildingTransport(pins) {
  const sha = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
  const [pack, index, catalog] = await Promise.all(['buildings.pack.bin', 'buildings.pack.index.json', 'catalog.json'].map(async uri => {
    const response = await fetch('/models/osm2world/hudson/' + uri); if (!response.ok) throw new Error(`Offline ${uri} failed`); return response.arrayBuffer();
  }));
  const [packSha256, indexSha256, catalogSha256] = await Promise.all([sha(pack), sha(index), sha(catalog)]);
  if (pack.byteLength !== pins.packBytes || packSha256 !== pins.packSha256) throw new Error('Offline pack differs from pinned source bytes/SHA');
  if (index.byteLength !== pins.indexBytes || indexSha256 !== pins.indexSha256) throw new Error('Offline index differs from pinned source bytes/SHA');
  if (catalogSha256 !== pins.catalogSha256) throw new Error('Offline catalog differs from pinned source SHA');
  // Interpret/cross-bind only the independently authenticated index.
  const manifest = JSON.parse(new TextDecoder().decode(index));
  if (manifest.formatVersion !== 1 || manifest.pack.uri !== 'buildings.pack.bin' || manifest.pack.bytes !== pins.packBytes
    || manifest.pack.sha256 !== pins.packSha256 || manifest.catalogSha256 !== pins.catalogSha256) throw new Error('Offline authenticated index cross-binding mismatch');
  return { packBytes: pack.byteLength, indexBytes: index.byteLength, packSha256, indexSha256, catalogSha256,
    expectedPackSha256: pins.packSha256, expectedIndexSha256: pins.indexSha256, expectedCatalogSha256: pins.catalogSha256,
    authenticatedIndexCrossBound: true, scope: 'Building pack/index/catalog delivery only; whole-world offline operation is not asserted' };
}
// Same one-shot/cancellation/freeze contract as capture-terrain-overlap.cjs.
// Install before app modules; capture only after actual world/GPU readiness.
function installCaptureFrameControl() {
  const nativeRequest = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  const callbacks = new Map();
  let nextId = 1, frozen = false, executedCallbacks = 0;
  const schedule = (id, entry) => {
    entry.nativeId = nativeRequest(timestamp => {
      entry.nativeId = null;
      if (!callbacks.has(id) || frozen) return;
      callbacks.delete(id); executedCallbacks++; entry.callback(timestamp);
    });
  };
  window.requestAnimationFrame = callback => {
    const id = nextId++, entry = { callback, nativeId: null };
    callbacks.set(id, entry); if (!frozen) schedule(id, entry); return id;
  };
  window.cancelAnimationFrame = id => {
    const entry = callbacks.get(id); if (!entry) return;
    if (entry.nativeId !== null) nativeCancel(entry.nativeId); callbacks.delete(id);
  };
  const status = () => ({ frozen, executedCallbacks, queuedCallbacks: callbacks.size });
  window.__cwCaptureFrameControl = {
    status,
    freeze() { frozen = true; return status(); },
    resume() { frozen = false; for (const [id, entry] of callbacks) if (entry.nativeId === null) schedule(id, entry); return status(); },
  };
}
async function snapshot(page) {
  const capture = { name: 'prepared-paused-passenger', imageCaptured: false, status: 'pending' };
  health.capture = capture; await save();
  try {
    await ready(page);
    await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    capture.before = await state(page);
    capture.frameFreeze = await page.evaluate(() => window.__cwCaptureFrameControl.freeze());
    await page.screenshot({ path: path.join(output, capture.name + '.png'), timeout: 90000 });
    capture.after = await state(page);
    capture.frameAfter = await page.evaluate(() => window.__cwCaptureFrameControl.status());
    fail(capture.frameFreeze.executedCallbacks === capture.frameAfter.executedCallbacks, 'Scene callbacks advanced during PNG capture');
    capture.bytes = (await fs.stat(path.join(output, capture.name + '.png'))).size;
    capture.imageCaptured = true; capture.status = 'captured';
  } catch (error) { capture.status = 'failed'; capture.error = error.stack; throw error; }
  finally { capture.frameResume = await page.evaluate(() => window.__cwCaptureFrameControl.resume()).catch(error => ({ error: error.message })); await save(); }
}
async function state(page) {
  return page.evaluate(() => {
    const read = label => { const element = document.querySelector(`[aria-label="${label}"]`); return { text: element?.textContent, ...element?.dataset }; };
    const clocks = document.querySelector('[data-journey-phase]');
    return { capturedAt: new Date().toISOString(), clocks: { ...clocks?.dataset }, position: read('真实列车位置'),
      source: read('转换建筑准备诊断'), streaming: read('地理区块流式加载诊断'), coverage: read('地形覆盖诊断') };
  });
}
async function ready(page) {
  await page.waitForFunction(() => {
    const stream = document.querySelector('[aria-label="地理区块流式加载诊断"]');
    return stream?.dataset.presentable === 'true' && stream.dataset.gpuPhase === 'idle'
      && Number.isSafeInteger(Number(stream.dataset.gpuCompleted)) && Number(stream.dataset.gpuCompleted) > 0
      && Number(/后续待上传 (\d+)/.exec(stream.textContent ?? '')?.[1]) === 0
      && document.querySelector('[aria-label="地形覆盖诊断"]')?.dataset.readyTiles === '49';
  }, null, { timeout: 240000 });
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  try {
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
    context = await browser.newContext({ serviceWorkers: 'block', viewport: health.viewport });
    await context.addInitScript(installCaptureFrameControl);
    await context.addInitScript(installPreparationEvidenceObserver);
    const page = await context.newPage();
    page.on('pageerror', error => health.errors.push(error.message));
    page.on('request', request => { if (request.url().includes('/models/osm2world/hudson/')) health.requests.push(request.url()); });
    let requested;
    const sourceRequested = new Promise(resolve => { requested = resolve; });
    const held = new Promise(resolve => { releasePack = resolve; });
    await page.route('**/models/osm2world/hudson/buildings.pack.bin', async route => { requested(); await held; await route.continue(); });
    await page.goto(new URL('?world=hudson&routeMetres=3123.283', base).href, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Board train', exact: true }).click();
    let sourceTimeout;
    await Promise.race([sourceRequested, new Promise((_, reject) => { sourceTimeout = setTimeout(() => reject(new Error('Held pack not requested')), 180000); })])
      .finally(() => clearTimeout(sourceTimeout));
    await page.waitForFunction(() => !!document.querySelector('[aria-label="真实列车位置"]')?.dataset.routeMetres);
    const before = await state(page); health.states.push({ name: 'held-before', ...before });
    await page.waitForTimeout(6000);
    const after = await state(page); health.states.push({ name: 'held-after', ...after });
    health.stage = 'held-pack'; await save();
    fail(before.position.routeMetres === after.position.routeMetres, 'Train moved while source pack was held');
    for (const sample of [before, after]) {
      fail(sample.clocks.worldPresentable === 'false', 'Held world was presented');
      fail(Number(sample.clocks.focusElapsedSeconds) === 0 && Number(sample.clocks.segmentElapsedSeconds) === 0, 'Focus or segment clock spent preparation time');
    }
    fail(Number(after.streaming.wholePrepareMs) > Number(before.streaming.wholePrepareMs), 'No actual preparation progress observed during hold');
    releasePack();
    // Observe the complete decode/validation/batch/GPU interval as well as the
    // held network source. A gate that opens at decode completion must fail.
    const gate = await page.waitForFunction(sampleUntilFullPreparationGate, before.position.routeMetres, { timeout: 240000, polling: 200 });
    health.initialPreparationGate = await gate.jsonValue();
    fail(!health.initialPreparationGate.failed, 'Initial source/GPU/current49 gate evidence was missing or clocks advanced before it');
    await page.waitForFunction(() => Number(document.querySelector('[data-journey-phase]')?.dataset.focusElapsedSeconds) > 0);
    const prepared = await state(page); health.states.push({ name: 'prepared', ...prepared });
    health.stage = 'prepared'; await save();
    const expected = { ready: 'true', buildings: '5853', tiles: '415', textures: '16', imageSources: '16', modelBytes: '25160336',
      textureBytes: '4984364', slicesVerified: '415', slicesParsed: '415', packVerified: 'true', modelRequests: '1', retainedPackBytes: '0' };
    for (const [key, value] of Object.entries(expected)) fail(prepared.source[key] === value, `Building source/transport ${key} differs`);
    const models = health.requests.filter(url => url.endsWith('buildings.pack.bin'));
    fail(models.length === 1 && health.requests.every(url => !url.endsWith('.glb')), 'Model transport count is not one pack / zero standalone GLBs');
    const images = health.requests.filter(url => /\.(png|jpg)$/.test(url));
    fail(images.length === 16 && new Set(images).size === 16, 'Shared image requests differ from original 16');
    health.directNetworkVerified = { modelRequests: models.length, standaloneModels: 0, imageRequests: images.length, serviceWorkers: 'blocked' };
    const start = Number(prepared.position.routeMetres);
    await page.waitForFunction(start => Number(document.querySelector('[aria-label="真实列车位置"]')?.dataset.routeMetres) > start + 1, start, { timeout: 120000 });
    health.states.push({ name: 'moving', ...await state(page) });
    const pauseButton = page.getByRole('button', { name: 'Pause journey', exact: true });
    health.pause = { beforeClick: await pauseButton.evaluate(button => {
      const bounds = button.getBoundingClientRect();
      const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      const hit = document.elementFromPoint(center.x, center.y);
      const style = getComputedStyle(button);
      return { bounds: bounds.toJSON(), projectedStyle: { width: button.style.width, height: button.style.height },
        computedStyle: { minWidth: style.minWidth, minHeight: style.minHeight, padding: style.padding,
          boxSizing: style.boxSizing, overflow: style.overflow }, center,
        hitTarget: { tag: hit?.tagName, label: hit?.closest('button')?.getAttribute('aria-label'), belongsToPause: hit === button || button.contains(hit) } };
    }) };
    health.stage = 'pause-control'; await save();
    // Keep Playwright's normal hit testing/stability checks: no force or dispatched click.
    await pauseButton.click();
    await page.getByRole('button', { name: 'Resume journey', exact: true }).waitFor({ state: 'visible' });
    health.pause.resumeLabelObserved = true;
    // Let the existing throttled HUD/position readouts acknowledge the click.
    await page.waitForTimeout(1000);
    health.pause.beforeHold = await state(page);
    health.pause.framesBefore = await page.evaluate(() => window.__cwCaptureFrameControl.status());
    await page.waitForTimeout(1000);
    health.pause.afterHold = await state(page);
    health.pause.framesAfter = await page.evaluate(() => window.__cwCaptureFrameControl.status());
    await save();
    fail(!health.pause.framesBefore.frozen && !health.pause.framesAfter.frozen
      && health.pause.framesAfter.executedCallbacks > health.pause.framesBefore.executedCallbacks, 'No active scene callbacks observed during pause hold');
    const pausedBefore = health.pause.beforeHold, pausedAfter = health.pause.afterHold;
    fail(Number.isFinite(Number(pausedBefore.position.routeMetres))
      && pausedBefore.position.routeMetres === pausedAfter.position.routeMetres, 'Train moved after native pause click');
    for (const key of ['focusElapsedSeconds', 'segmentElapsedSeconds']) {
      fail(Number.isFinite(Number(pausedBefore.clocks[key])) && pausedBefore.clocks[key] === pausedAfter.clocks[key], `${key} advanced after native pause click`);
    }
    fail(await page.getByRole('button', { name: 'Resume journey', exact: true }).isVisible(), 'Journey no longer paused before PNG');
    health.pause.held = true; health.stage = 'paused'; await save();
    await snapshot(page);
    await save(); await context.close();

    // Independent context: no request interception and SW genuinely enabled.
    context = await browser.newContext({ serviceWorkers: 'allow', viewport: health.viewport });
    health.stage = 'service-worker-install'; await save();
    const installed = await context.newPage();
    installed.on('pageerror', error => health.errors.push(error.message));
    await installed.goto(base, { waitUntil: 'load' });
    await installed.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active, null, { timeout: 240000 });
    await installed.reload({ waitUntil: 'load' });
    await installed.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60000 });
    health.serviceWorker = await installed.evaluate(async () => {
      const keys = [];
      for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) keys.push(new URL(request.url).pathname);
      const root = '/models/osm2world/hudson/';
      return { controlled: !!navigator.serviceWorker.controller,
        pack: keys.includes(root + 'buildings.pack.bin'), index: keys.includes(root + 'buildings.pack.index.json'), catalog: keys.includes(root + 'catalog.json'),
        standaloneModels: keys.filter(key => /^\/models\/osm2world\/hudson\/tile-[^/]+\/buildings\.glb$/.test(key)).length,
        sharedTextures: new Set(keys.filter(key => key.startsWith(root + 'textures/'))).size,
        treeGLBs: new Set(keys.filter(key => key.startsWith('/models/trees/') && key.endsWith('.glb'))).size };
    });
    fail(health.serviceWorker.controlled && health.serviceWorker.pack && health.serviceWorker.index && health.serviceWorker.catalog
      && health.serviceWorker.standaloneModels === 0 && health.serviceWorker.sharedTextures === 16 && health.serviceWorker.treeGLBs === 9, 'SW-enabled precache membership failed');
    await context.setOffline(true);
    health.offlineBuildingAssets = await installed.evaluate(verifyOfflineBuildingTransport, fixedTransport);
    fail(health.offlineBuildingAssets.packBytes === fixedTransport.packBytes && health.offlineBuildingAssets.indexBytes === fixedTransport.indexBytes
      && health.offlineBuildingAssets.packSha256 === fixedTransport.packSha256 && health.offlineBuildingAssets.indexSha256 === fixedTransport.indexSha256
      && health.offlineBuildingAssets.catalogSha256 === fixedTransport.catalogSha256 && health.offlineBuildingAssets.authenticatedIndexCrossBound,
    'Offline transport differs from independent pinned bytes/SHA');
    fail(health.errors.length === 0, 'Application errors observed');
    health.passed = true; health.stage = 'complete'; await save();
  } catch (error) { health.passed = false; health.failure = error.stack; await save(); process.exitCode = 1; }
  finally { releasePack?.(); await context?.close(); await browser?.close(); }
})();
