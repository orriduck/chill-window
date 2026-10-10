// Run only in the bounded GitHub Actions review; no local browser is required.
const { chromium } = require(process.env.PW_MODULE_PATH);
const fs = require('node:fs/promises');
const path = require('node:path');
const output = process.env.CW_CAPTURE_DIR;
const health = {
  commit: process.env.CW_CAPTURE_SHA, scope: 'Exactly three paused 2790m passenger views: current, raw20m, putnam2019. No full-route or hardware performance acceptance.',
  rendering: 'Playwright Chromium / SwiftShader software WebGL', serviceWorkers: 'Blocked', visualReviewRequired: true,
  console: [], requestFailures: [], states: [],
};
let browser, context, page;
const read = label => page.getByLabel(label, { exact: true }).evaluate(element => ({ text: element.textContent, ...element.dataset }));
// Installed before any app module. Native callbacks already submitted after
// freeze are deferred too; cancellation retains normal one-shot RAF semantics.
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
const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
// Serialized into the browser as one synchronous callback. Recheck the latest
// actual DOM proof and freeze in the same task, so an intervening RAF cannot
// start another forward-upload batch after the gate but before capture.
function strictReadyAndMaybeFreeze({ freeze = false, name, metres } = {}) {
  const status = document.querySelector('[aria-label="真实地理加载状态"]');
  const coverage = document.querySelector('[aria-label="地形覆盖诊断"]');
  const stream = document.querySelector('[aria-label="地理区块流式加载诊断"]');
  const ready = status?.textContent.includes('49/49') && status.textContent.includes('场景就绪') && coverage?.dataset.readyTiles === '49'
    && stream?.dataset.gpuPhase === 'idle' && Number(stream.dataset.gpuCompleted) > 0 && stream.dataset.presentable === 'true'
    && stream.textContent.includes('后续待上传 0') && stream.textContent.includes('视野缺块 0');
  if (!ready) return false;
  if (!freeze) return true;
  const position = document.querySelector('[aria-label="真实列车位置"]');
  const source = document.querySelector('[aria-label="局部地形来源诊断"]');
  const rays = document.querySelector('[aria-label="实际乘客地形视线"]');
  const motion = document.querySelector('[aria-label="地理运动门控"]');
  const journey = document.querySelector('[data-journey-phase]');
  let report;
  try { report = JSON.parse(rays?.dataset.report ?? 'null'); } catch { return false; }
  if (document.fonts.status !== 'loaded' || !position || !journey
    || !Number.isFinite(Number(position.dataset.routeMetres)) || Math.abs(Number(position.dataset.routeMetres) - metres) > 0.01
    || Number(journey.dataset.focusElapsedSeconds) !== 0 || Number(journey.dataset.segmentElapsedSeconds) !== 0
    || !motion?.textContent.includes('暂停 true') || !motion.textContent.includes('俯视 false')
    || source?.dataset.sourceMode !== name || report?.sourceMode !== name) return false;
  return { ...window.__cwCaptureFrameControl.freeze(), sceneFrame: status.dataset.sceneFrame, fontsStatus: document.fonts.status };
}
async function ready() {
  await page.waitForFunction(strictReadyAndMaybeFreeze, {}, { timeout: 180000, polling: 100 });
  await frames();
  if (await page.locator('[data-webgl="unavailable"], vite-error-overlay').count()) throw new Error('WebGL or app unavailable');
}
async function snapshot(name, metres) {
  const state = { name, imageCaptured: false, captureStatus: 'pending', captureStartedAt: new Date().toISOString() };
  health.states.push(state);
  console.log(`[terrain capture] ${name}: awaiting fonts and stable frame`);
  await fs.writeFile(path.join(output, 'health.json'), JSON.stringify(health, null, 2));
  try {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const frozen = await page.waitForFunction(strictReadyAndMaybeFreeze, { freeze: true, name, metres }, { timeout: 180000, polling: 100 });
    state.freezeBefore = await frozen.jsonValue();
    await frozen.dispose();
    Object.assign(state, {
      url: page.url(), viewport: page.viewportSize(),
      position: await read('真实列车位置'), coverage: await read('地形覆盖诊断'), status: await read('真实地理加载状态'),
      terrainSource: await read('局部地形来源诊断'), rays: await read('实际乘客地形视线'), journey: await page.locator('[data-journey-phase]').evaluate(e => ({ ...e.dataset })), streaming: await read('地理区块流式加载诊断'), motion: await read('地理运动门控'), aerial: await read('真实航片准备诊断'),
    });
    if (Number(state.journey.focusElapsedSeconds) !== 0 || Number(state.journey.segmentElapsedSeconds) !== 0) throw new Error('Focus clock advanced before Pause');
    if (state.terrainSource.sourceMode !== name || JSON.parse(state.rays.report).sourceMode !== name) throw new Error('Wrong terrain source or missing actual camera rays');
    if (Math.abs(Number(state.position.routeMetres) - metres) > 0.01) throw new Error(`Camera moved away from exact paused position: ${JSON.stringify(state)}`);
    if (state.coverage.readyTiles !== '49' || !state.status.text.includes('49/49') || !state.status.text.includes('场景就绪')) throw new Error(`Incomplete capture: ${JSON.stringify(state)}`);
    if (!state.motion.text.includes('暂停 true') || !state.motion.text.includes('俯视 false')) throw new Error(`Not paused default passenger view: ${JSON.stringify(state)}`);
    if (!state.streaming.text.includes('视野缺块 0') || state.streaming.gpuPhase !== 'idle' || !state.streaming.text.includes('后续待上传 0')) throw new Error(`GPU terrain not idle and ready: ${JSON.stringify(state)}`);
    console.log(`[terrain capture] ${name}: frozen scene frame ${state.freezeBefore.sceneFrame}, GPU idle, coverage 49/49`);
    await fs.writeFile(path.join(output, 'health.json'), JSON.stringify(health, null, 2));
    const pngPath = path.join(output, `${name}.png`);
    await page.screenshot({ path: pngPath, timeout: 90000 });
    state.imageCaptured = true;
    state.png = { filename: `${name}.png`, bytes: (await fs.stat(pngPath)).size };
    state.freezeAfter = await page.evaluate(() => ({
      ...window.__cwCaptureFrameControl.status(),
      sceneFrame: document.querySelector('[aria-label="真实地理加载状态"]')?.dataset.sceneFrame,
    }));
    if (!state.freezeBefore.frozen || !state.freezeAfter.frozen
      || state.freezeBefore.sceneFrame !== state.freezeAfter.sceneFrame
      || state.freezeBefore.executedCallbacks !== state.freezeAfter.executedCallbacks) throw new Error(`Application advanced during screenshot: ${JSON.stringify(state)}`);
    state.captureStatus = 'captured'; state.capturedAt = new Date().toISOString();
    console.log(`[terrain capture] ${name}: PNG saved (${state.png.bytes} bytes), scene frame unchanged`);
  } catch (error) {
    state.captureStatus = 'failed'; state.captureFailure = String(error.stack ?? error);
    throw error;
  } finally {
    let resumeError;
    try {
      state.resume = await page.evaluate(() => window.__cwCaptureFrameControl.resume());
      if (state.resume?.error || state.resume?.frozen !== false) throw new Error(`RAF did not resume: ${JSON.stringify(state.resume)}`);
    } catch (error) {
      resumeError = error;
      state.resumeFailure = String(error.stack ?? error);
      state.captureStatus = 'failed'; health.runtimePassed = false;
    }
    await fs.writeFile(path.join(output, 'health.json'), JSON.stringify(health, null, 2));
    // Retain a pending original capture exception; otherwise propagate the
    // resume failure, including after the final PNG of the final case.
    if (resumeError && !Object.hasOwn(state, 'captureFailure')) throw resumeError;
  }
}

(async () => {
  try {
    await fs.mkdir(output, { recursive: true });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
    context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 640, height: 360 } });
    for (const mode of ['current', 'raw20m', 'putnam2019']) {
      page = await context.newPage(); page.setDefaultTimeout(90000);
      page.on('console', message => { if (['error', 'warning'].includes(message.type())) health.console.push({ sourceMode: mode, level: message.type(), text: message.text() }); });
      page.on('pageerror', error => health.console.push({ sourceMode: mode, level: 'pageerror', text: error.message }));
      page.on('requestfailed', request => { if (!request.url().endsWith('/favicon.ico')) health.requestFailures.push({ sourceMode: mode, url: request.url(), error: request.failure()?.errorText }); });
      await page.addInitScript(installCaptureFrameControl);
      await page.addInitScript(() => {
        window.__cwPausePointer = null;
        document.addEventListener('pointerdown', event => {
          const target = event.target.closest?.('button');
          if (target?.getAttribute('aria-label') === 'Pause journey') window.__cwPausePointer = { trusted: event.isTrusted, target: target.getAttribute('aria-label'), x: event.clientX, y: event.clientY,
            presentable: document.querySelector('[data-world-presentable]')?.dataset.worldPresentable,
            initialReadyTiles: document.querySelector('[aria-label="地理区块流式加载诊断"]')?.dataset.initialReadyTiles ?? null }; 
        }, true);
      });
      await page.goto(`http://127.0.0.1:4173/?world=hudson&routeMetres=2790&terrainSource=${mode}`, { waitUntil: 'domcontentloaded' });
      await page.getByText('Advanced settings', { exact: true }).click();
      await page.getByRole('button', { name: 'Daylight', exact: true }).click();
      await page.getByRole('button', { name: 'Clear', exact: true }).click();
      await page.getByRole('button', { name: 'Board train', exact: true }).click();
      const pause = page.getByRole('button', { name: 'Pause journey', exact: true });
      await pause.waitFor({ state: 'visible' });
      const box = await pause.boundingBox();
      if (!box || box.width <= 0 || box.height <= 0) throw new Error('Missing actual Pause hitbox');
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.getByRole('button', { name: 'Resume journey', exact: true }).waitFor({ state: 'visible' });
      const pointer = await page.evaluate(() => window.__cwPausePointer);
      if (!pointer?.trusted || pointer.target !== 'Pause journey' || pointer.presentable !== 'false' || pointer.initialReadyTiles !== null) throw new Error(`Pause was not a trusted pointer before world readiness: ${JSON.stringify(pointer)}`);
      await ready();
      await page.waitForFunction(() => !!document.querySelector('[aria-label="实际乘客地形视线"]')?.dataset.report, null, { timeout: 30000 });
      await snapshot(mode, 2790);
      health.states.at(-1).pausePointer = pointer;
      await page.close(); page = null;
    }
    const cameras = health.states.map(state => JSON.parse(state.rays.report));
    if (cameras.some(camera => JSON.stringify(camera.cameraPosition) !== JSON.stringify(cameras[0].cameraPosition) || JSON.stringify(camera.cameraQuaternion) !== JSON.stringify(cameras[0].cameraQuaternion))) throw new Error('Actual camera differs between A/B states');
    health.runtimePassed = health.states.length === 3 && health.states.every(state => state.captureStatus === 'captured' && state.resume?.frozen === false) && !health.console.some(item => ['error', 'pageerror'].includes(item.level)) && !health.requestFailures.length;
    if (!health.runtimePassed) process.exitCode = 1;
  } catch (error) {
    health.runtimePassed = false; health.failure = String(error.stack ?? error); process.exitCode = 1;
    if (page) {
      health.finalDiagnostic = await page.evaluate(() => Object.fromEntries(['真实地理加载状态', '地形覆盖诊断', '局部地形来源诊断', '实际乘客地形视线', '真实列车位置', '地理运动门控'].map(label => [label, document.querySelector(`[aria-label="${label}"]`)?.textContent]))).catch(() => ({}));
      await page.screenshot({ path: path.join(output, 'failure.png'), timeout: 15000 }).catch(() => {});
    }
  } finally {
    await fs.writeFile(path.join(output, 'health.json'), JSON.stringify(health, null, 2));
    await context?.close(); await browser?.close();
  }
})();
