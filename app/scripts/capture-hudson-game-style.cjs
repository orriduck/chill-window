// Dedicated bounded GitHub cloud capture. Never run a local WebGL browser.
const { chromium } = require(process.env.PW_MODULE_PATH);
const fs = require('node:fs/promises');
const path = require('node:path');
const output = process.env.CW_CAPTURE_DIR;
const health = { commit: process.env.CW_CAPTURE_SHA, scope: 'Fantasy only: paused 2790m forest, paused 21083.216m village, same village map. Native Pause, F5/Escape, map pan/zoom/click. No full-route or hardware-performance acceptance.', rendering: 'Chromium / SwiftShader', visualReviewRequired: true, console: [], requestFailures: [], states: [] };
let browser, context, page;
const read = label => page.getByLabel(label, { exact: true }).evaluate(e => ({ text: e.textContent, ...e.dataset }));
function installCaptureFrameControl() {
  const nativeRequest = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  const callbacks = new Map();
  let nextId = 1, frozen = false, executedCallbacks = 0;
  const schedule = (id, entry) => {
    entry.nativeId = nativeRequest(timestamp => {
      entry.nativeId = null;
      if (!callbacks.has(id)) return;
      if (frozen) return;
      callbacks.delete(id); executedCallbacks++;
      entry.callback(timestamp);
    });
  };
  window.requestAnimationFrame = callback => {
    const id = nextId++, entry = { callback, nativeId: null };
    callbacks.set(id, entry);
    if (!frozen) schedule(id, entry);
    return id;
  };
  window.cancelAnimationFrame = id => {
    const entry = callbacks.get(id);
    if (!entry) return;
    if (entry.nativeId !== null) nativeCancel(entry.nativeId);
    callbacks.delete(id);
  };
  const status = () => ({ frozen, executedCallbacks, queuedCallbacks: callbacks.size });
  window.__cwCaptureFrameControl = {
    status,
    freeze() { frozen = true; return status(); },
    resume() {
      frozen = false;
      for (const [id, entry] of callbacks) if (entry.nativeId === null) schedule(id, entry);
      return status();
    },
  };
}
function strictReadyAndMaybeFreeze({ freeze = false, metres, inspection = false } = {}) {
  const get = label => document.querySelector(`[aria-label="${label}"]`);
  const status = get('真实地理加载状态'), coverage = get('地形覆盖诊断'), stream = get('地理区块流式加载诊断'), game = get('游戏场景准备诊断'), motion = get('地理运动门控'), position = get('真实列车位置'), journey = document.querySelector('[data-journey-phase]');
  const ready = status?.textContent.includes('场景就绪') && status.textContent.includes('49/49') && coverage?.dataset.readyTiles === '49'
    && stream?.dataset.gpuPhase === 'idle' && Number(stream.dataset.gpuCompleted) > 0 && stream.dataset.presentable === 'true'
    && stream.dataset.initialGpuPhase === 'idle' && Number(stream.dataset.initialGpuCompleted) > 0 && stream.dataset.initialReadyTiles === '49'
    && stream.dataset.initialTotalTiles === '49' && stream.dataset.initialPendingGpu === '0' && stream.dataset.pendingGpu === '0' && stream.dataset.visibleMissing === '0'
    && game?.dataset.style === 'fantasy' && game.dataset.ready === 'true' && game.dataset.loadedAssets === '19' && game.dataset.houseDesigns === '3'
    && Number(game.dataset.placedHouses) > 0 && Number(game.dataset.placedTrees) > 0 && Number(game.dataset.placedGroundcover) > 0
    && journey?.dataset.worldPresentable === 'true' && Number(journey.dataset.focusElapsedSeconds) === 0 && Number(journey.dataset.segmentElapsedSeconds) === 0
    && Number.isFinite(Number(position?.dataset.routeMetres)) && Math.abs(Number(position.dataset.routeMetres) - metres) < 0.01
    && motion?.textContent.includes('暂停 true') && motion.textContent.includes(`俯视 ${inspection}`) && document.fonts.status === 'loaded';
  if (!ready) return false;
  if (!freeze) return true;
  return { ...window.__cwCaptureFrameControl.freeze(), sceneFrame: status.dataset.sceneFrame, fontsStatus: document.fonts.status };
}
const ready = (metres, inspection = false) => page.waitForFunction(strictReadyAndMaybeFreeze, { metres, inspection }, { timeout: 180000, polling: 100 });
async function snapshot(name, metres, inspection = false) {
  const state = { name, captureStatus: 'pending', imageCaptured: false }; health.states.push(state);
  console.log(`[fantasy capture] ${name}: waiting for actual ready scene`);
  try {
    await page.evaluate(() => document.fonts.ready);
    const handle = await page.waitForFunction(strictReadyAndMaybeFreeze, { freeze: true, metres, inspection }, { timeout: 180000, polling: 100 });
    state.freezeBefore = await handle.jsonValue(); await handle.dispose();
    Object.assign(state, { url: page.url(), viewport: page.viewportSize(), status: await read('真实地理加载状态'), position: await read('真实列车位置'), streaming: await read('地理区块流式加载诊断'), coverage: await read('地形覆盖诊断'), assets: await read('游戏场景准备诊断'), motion: await read('地理运动门控'), map: await read('地图检查位置'), journey: await page.locator('[data-journey-phase]').evaluate(e => ({ ...e.dataset })) });
    await fs.writeFile(path.join(output, 'health.json'), JSON.stringify(health, null, 2));
    await page.screenshot({ path: path.join(output, `${name}.png`), timeout: 90000 });
    state.freezeAfter = await page.evaluate(() => ({ ...window.__cwCaptureFrameControl.status(), sceneFrame: document.querySelector('[aria-label="真实地理加载状态"]').dataset.sceneFrame }));
    if (!state.freezeAfter.frozen || state.freezeBefore.sceneFrame !== state.freezeAfter.sceneFrame || state.freezeBefore.executedCallbacks !== state.freezeAfter.executedCallbacks) throw new Error('Scene advanced during PNG capture');
    state.imageCaptured = true; state.captureStatus = 'captured'; state.png = { filename: `${name}.png`, bytes: (await fs.stat(path.join(output, `${name}.png`))).size };
    console.log(`[fantasy capture] ${name}: ${state.png.bytes}B saved at frozen frame ${state.freezeBefore.sceneFrame}`);
  } catch (error) { state.captureStatus = 'failed'; state.failure = String(error.stack ?? error); throw error; }
  finally {
    let resumeError;
    try { state.resume = await page.evaluate(() => window.__cwCaptureFrameControl.resume()); if (state.resume.frozen !== false) throw new Error('RAF did not resume'); }
    catch (error) { resumeError = error; state.resumeFailure = String(error); state.captureStatus = 'failed'; }
    await fs.writeFile(path.join(output, 'health.json'), JSON.stringify(health, null, 2));
    if (resumeError && !state.failure) throw resumeError;
  }
}
async function boardAndPause(metres, checkEarlyMap = false) {
  page = await context.newPage(); page.setDefaultTimeout(90000);
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) health.console.push({ metres, level: m.type(), text: m.text() }); });
  page.on('pageerror', e => health.console.push({ metres, level: 'pageerror', text: e.message }));
  page.on('requestfailed', r => { if (!r.url().endsWith('/favicon.ico')) health.requestFailures.push({ metres, url: r.url(), error: r.failure()?.errorText }); });
  page.on('request', r => { if (/osm2world|models\/trees|imagery\/|putnam-2790|materials\/forest/.test(r.url())) health.console.push({ level: 'error', text: `Unused legacy download: ${r.url()}` }); });
  let releasePaintedSource, paintedReleased = false, paintedIntercepted, paintedFulfilled;
  const sourceIntercepted = new Promise(resolve => { paintedIntercepted = resolve; });
  const paintedGate = new Promise(resolve => { releasePaintedSource = resolve; });
  const sourceFulfilled = new Promise(resolve => { paintedFulfilled = resolve; });
  if (checkEarlyMap) {
    health.earlyMapWhileLoading = { requestedDelay: 'Hold original grass PNG until early F5/Escape assertions finish; bounded at 60s', interceptedRequests: 0, fulfilledRequests: 0, states: [] };
    // This page-only interception is installed before app module requests.
    // Preserve the exact origin response/bytes, delaying only delivery.
    await page.route('**/textures/fantasy/grass_34.png', async route => {
      const proof = health.earlyMapWhileLoading;
      proof.interceptedRequests++; proof.url = route.request().url(); proof.interceptedAt = Date.now();
      try {
        const response = await route.fetch(); const body = await response.body();
        proof.originStatus = response.status(); proof.originalBytes = body.byteLength;
        if (response.status() !== 200 || body.byteLength !== 561283) throw new Error('Delayed grass source response differs from original');
        paintedIntercepted();
        let limit;
        const bounded = new Promise(resolve => { limit = setTimeout(() => { proof.delayLimitReached = true; resolve(); }, 60000); });
        try { await Promise.race([paintedGate, bounded]); } finally { clearTimeout(limit); }
        await route.fulfill({ response, body }); paintedReleased = true;
        proof.fulfilledRequests++; proof.fulfilledAt = Date.now(); proof.heldMs = proof.fulfilledAt - proof.interceptedAt; paintedFulfilled({ fulfilled: true });
      } catch (error) { proof.sourceFailure = String(error.stack ?? error); paintedIntercepted(); await route.abort().catch(() => {}); paintedFulfilled({ fulfilled: false, error: proof.sourceFailure }); }
    });
  }
  await page.addInitScript(installCaptureFrameControl);
  await page.addInitScript(() => {
    window.__cwPausePointer = null;
    document.addEventListener('pointerdown', event => { const b = event.target.closest?.('button'); if (b?.getAttribute('aria-label') === 'Pause journey') window.__cwPausePointer = { trusted: event.isTrusted, target: b.getAttribute('aria-label'), presentable: document.querySelector('[data-world-presentable]')?.dataset.worldPresentable, initialReadyTiles: document.querySelector('[aria-label="地理区块流式加载诊断"]')?.dataset.initialReadyTiles ?? null }; }, true);
  });
  await page.goto(`http://127.0.0.1:4173/?world=hudson&routeMetres=${metres}`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Advanced settings', { exact: true }).click();
  await page.getByRole('button', { name: 'Daylight', exact: true }).click();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('button', { name: 'Board train', exact: true }).click();
  const pause = page.getByRole('button', { name: 'Pause journey', exact: true }); await pause.waitFor({ state: 'visible' }); const box = await pause.boundingBox();
  if (!box) throw new Error('Missing native Pause hit area'); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('button', { name: 'Resume journey', exact: true }).waitFor({ state: 'visible' });
  const pointer = await page.evaluate(() => window.__cwPausePointer);
  if (!pointer?.trusted || pointer.target !== 'Pause journey' || pointer.presentable !== 'false' || pointer.initialReadyTiles !== null) throw new Error(`Pause was not before readiness: ${JSON.stringify(pointer)}`);
  if (checkEarlyMap) {
    // The timer only bounds the intentional hold. It cannot substitute for
    // evidence that the original request was actually intercepted/pending.
    let interceptionLimit;
    try {
      await Promise.race([sourceIntercepted, new Promise((_, reject) => { interceptionLimit = setTimeout(() => reject(new Error('No actual painted grass request intercepted')), 30000); })]);
    } finally { clearTimeout(interceptionLimit); }
    const proof = health.earlyMapWhileLoading;
    if (proof.interceptedRequests !== 1 || proof.originalBytes !== 561283 || proof.sourceFailure || paintedReleased) throw new Error(`Missing actual pending painted source: ${JSON.stringify(proof)}`);
    const loadingState = async name => {
      const state = { name, streaming: await read('地理区块流式加载诊断'), motion: await read('地理运动门控'), position: await read('真实列车位置'), journey: await page.locator('[data-journey-phase]').evaluate(e => ({ ...e.dataset })), delayedSourceFulfilled: paintedReleased };
      proof.states.push(state);
      if (state.delayedSourceFulfilled || state.streaming.presentable !== 'false' || state.journey.worldPresentable !== 'false' || Number(state.journey.focusElapsedSeconds) !== 0 || Number(state.journey.segmentElapsedSeconds) !== 0 || Math.abs(Number(state.position.routeMetres) - metres) > .01) throw new Error(`Early map bypassed resource/preparation/Pause gate: ${JSON.stringify(state)}`);
    };
    let browserResponse;
    try {
      await page.waitForFunction(() => document.querySelector('[aria-label="地理区块流式加载诊断"]')?.dataset.preparationPhase === 'preparing', null, { timeout: 30000 });
      await page.keyboard.press('F5'); await page.getByLabel('真实路线检查', { exact: true }).waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.querySelector('[aria-label="地理运动门控"]')?.textContent.includes('俯视 true'), null, { timeout: 30000 });
      await loadingState('F5 before painted source ready');
      await page.keyboard.press('Escape'); await page.getByLabel('真实路线检查', { exact: true }).waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.querySelector('[aria-label="地理运动门控"]')?.textContent.includes('俯视 false'), null, { timeout: 30000 });
      await loadingState('Escape while painted source pending');
    } finally {
      // Install the browser-response listener before release. Its event may
      // precede route.fulfill's resolution, so independently await both.
      browserResponse = page.waitForResponse(response => response.url().endsWith('/textures/fantasy/grass_34.png') && response.status() === 200, { timeout: 30000 })
        .then(response => { proof.browserResponseStatus = response.status(); proof.browserResponseAt = Date.now(); return true; })
        .catch(error => { proof.browserResponseFailure = String(error); return false; });
      releasePaintedSource();
    }
    let fulfillmentLimit, delivered;
    try {
      delivered = await Promise.race([Promise.all([browserResponse, sourceFulfilled]), new Promise((_, reject) => { fulfillmentLimit = setTimeout(() => reject(new Error('Delayed original source fulfillment did not complete')), 30000); })]);
    } finally { clearTimeout(fulfillmentLimit); }
    if (!delivered[0] || !delivered[1].fulfilled || proof.fulfilledRequests !== 1 || proof.delayLimitReached) throw new Error(`Painted source delay did not finish as intended: ${JSON.stringify(proof)}`);
  }
  await ready(metres); return pointer;
}
(async () => {
  try {
    await fs.mkdir(output, { recursive: true });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
    context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 960, height: 540 } });
    let pointer = await boardAndPause(2790, true); await snapshot('01-forest-passenger', 2790); health.states.at(-1).pausePointer = pointer; await page.close(); page = null;
    const village = 21083.216; pointer = await boardAndPause(village); await snapshot('02-village-passenger', village); health.states.at(-1).pausePointer = pointer;
    await page.keyboard.press('F5'); await page.getByLabel('真实路线检查', { exact: true }).waitFor({ state: 'visible' }); await ready(village, true);
    const before = await read('地图检查位置');
    await page.mouse.move(220, 260); await page.mouse.down(); await page.mouse.move(310, 305, { steps: 8 }); await page.mouse.up(); await page.mouse.wheel(0, -200);
    await page.waitForFunction(previous => { const d = document.querySelector('[aria-label="地图检查位置"]')?.dataset; return d && (d.x !== previous.x || d.z !== previous.z) && Number(d.distance) !== Number(previous.distance); }, before, { timeout: 30000 });
    const range = page.getByLabel('真实路线里程', { exact: true }); const priorPreview = await range.inputValue(); await page.mouse.click(280, 290);
    await page.waitForFunction(previous => document.querySelector('[aria-label="真实路线里程"]')?.value !== previous, priorPreview, { timeout: 30000 });
    await snapshot('03-village-map', village, true);
    health.mapInteraction = { before, after: await read('地图检查位置'), clickPreviewMetres: await range.inputValue(), pausedTrainMetres: (await read('真实列车位置')).routeMetres };
    await page.keyboard.press('Escape'); await page.getByLabel('真实路线检查', { exact: true }).waitFor({ state: 'hidden' }); await ready(village);
    health.returnToRide = { position: await read('真实列车位置'), streaming: await read('地理区块流式加载诊断'), motion: await read('地理运动门控') };
    if (Math.abs(Number(health.returnToRide.position.routeMetres) - village) > 0.01 || health.returnToRide.streaming.visibleMissing !== '0') throw new Error('Map return moved paused train or exposed missing chunks');
    health.runtimePassed = health.states.length === 3 && health.states.every(s => s.captureStatus === 'captured' && s.resume.frozen === false) && !health.console.some(c => ['error', 'pageerror'].includes(c.level)) && !health.requestFailures.length;
    if (!health.runtimePassed) process.exitCode = 1;
  } catch (error) {
    health.runtimePassed = false; health.failure = String(error.stack ?? error); process.exitCode = 1;
    if (page) { health.finalDiagnostic = await page.evaluate(() => Object.fromEntries(['真实地理加载状态', '真实列车位置', '地理区块流式加载诊断', '游戏场景准备诊断', '地理运动门控'].map(l => [l, document.querySelector(`[aria-label="${l}"]`)?.textContent]))).catch(() => ({})); await page.screenshot({ path: path.join(output, 'failure.png'), timeout: 15000 }).catch(() => {}); }
  } finally { await fs.writeFile(path.join(output, 'health.json'), JSON.stringify(health, null, 2)); await context?.close(); await browser?.close(); }
})();
