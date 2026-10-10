// Run only in the bounded GitHub Actions review; no local browser is required.
const { chromium } = require(process.env.PW_MODULE_PATH);
const fs = require('node:fs/promises');
const path = require('node:path');
const output = process.env.CW_CAPTURE_DIR;
const health = {
  commit: process.env.CW_CAPTURE_SHA, scope: 'Background DEM overlap, seven paused default passenger views; full-route continuity and hardware performance not assessed',
  rendering: 'Playwright Chromium / SwiftShader software WebGL', serviceWorkers: 'Blocked', visualReviewRequired: true,
  console: [], requestFailures: [], states: [],
};
let browser, context, page;
const read = label => page.getByLabel(label, { exact: true }).evaluate(element => ({ text: element.textContent, ...element.dataset }));
const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function ready() {
  await page.waitForFunction(() => {
    const status = document.querySelector('[aria-label="真实地理加载状态"]')?.textContent ?? '';
    const coverage = document.querySelector('[aria-label="地形覆盖诊断"]')?.dataset.readyTiles;
    return status.includes('49/49') && status.includes('场景就绪') && coverage === '49';
  }, null, { timeout: 240000 });
  await frames();
  if (await page.locator('[data-webgl="unavailable"], vite-error-overlay').count()) throw new Error('WebGL or app unavailable');
}
async function snapshot(name, metres) {
  const state = {
    name, capturedAt: new Date().toISOString(), url: page.url(), viewport: page.viewportSize(),
    position: await read('真实列车位置'), coverage: await read('地形覆盖诊断'), status: await read('真实地理加载状态'),
    streaming: await read('地理区块流式加载诊断'), motion: await read('地理运动门控'), aerial: await read('真实航片准备诊断'),
  };
  if (Math.abs(Number(state.position.routeMetres) - metres) > 0.01) throw new Error(`Camera moved away from exact paused position: ${JSON.stringify(state)}`);
  if (state.coverage.readyTiles !== '49' || !state.status.text.includes('49/49') || !state.status.text.includes('场景就绪')) throw new Error(`Incomplete capture: ${JSON.stringify(state)}`);
  if (!state.motion.text.includes('暂停 true') || !state.motion.text.includes('俯视 false')) throw new Error(`Not paused default passenger view: ${JSON.stringify(state)}`);
  if (!state.streaming.text.includes('视野缺块 0')) throw new Error(`Visible terrain not ready: ${JSON.stringify(state)}`);
  health.states.push(state);
  await fs.writeFile(path.join(output, 'health.json'), JSON.stringify(health, null, 2));
  await page.screenshot({ path: path.join(output, `${name}.png`), timeout: 90000 });
}
async function debugChange(change) {
  await page.keyboard.press('F5');
  await page.getByLabel('真实路线检查', { exact: true }).waitFor({ state: 'visible' });
  await change();
  await page.keyboard.press('Escape');
  await page.getByLabel('真实路线检查', { exact: true }).waitFor({ state: 'hidden' });
  await ready();
}
(async () => {
  try {
    await fs.mkdir(output, { recursive: true });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
    context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 720 } });
    page = await context.newPage(); page.setDefaultTimeout(90000);
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) health.console.push({ level: message.type(), text: message.text() }); });
    page.on('pageerror', error => health.console.push({ level: 'pageerror', text: error.message }));
    page.on('requestfailed', request => { if (!request.url().endsWith('/favicon.ico')) health.requestFailures.push({ url: request.url(), error: request.failure()?.errorText }); });
    await page.goto('http://127.0.0.1:4173/?world=hudson&routeMetres=2790', { waitUntil: 'domcontentloaded' });
    await page.getByText('Advanced settings', { exact: true }).click();
    await page.getByRole('button', { name: 'Daylight', exact: true }).click();
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await page.getByRole('button', { name: 'Board train', exact: true }).click();
    await page.getByRole('button', { name: 'Pause journey', exact: true }).click();
    await ready();
    // Existing Debug controls change geography/layers only. No orbit, view
    // preset or passenger-camera parameters are changed anywhere in this run.
    for (const [label, metres] of [['2790m', 2790], ['15920m', 15920], ['3000m', 3000], ['10000m', 10000], ['1830m', 1830], ['cold-spring', 3123.283], ['peekskill', 21083.216]]) {
      await debugChange(async () => {
        for (const name of ['林木', '建筑', '道路', 'Metro-North 站台', '地表', '远处地形', '水域']) await page.getByLabel(`真实地理${name}`, { exact: true }).check();
        const details = page.getByText('数据来源与加载诊断', { exact: true });
        if (!(await details.evaluate(element => element.parentElement.open))) await details.click();
        await page.getByLabel('真实地表影像', { exact: true }).check();
        await page.getByLabel('真实路线里程', { exact: true }).evaluate((input, value) => { input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true })); }, metres);
        await page.getByRole('button', { name: '列车跳到这个位置', exact: true }).click();
        await page.waitForFunction(value => Math.abs(Number(document.querySelector('[aria-label="真实列车位置"]')?.dataset.routeMetres) - value) < 0.01, metres, { timeout: 240000 });
      });
      await snapshot(`${label}-01-default-background-on`, metres);
      await debugChange(() => page.getByLabel('真实地理远处地形', { exact: true }).uncheck());
      if ((await read('地形覆盖诊断')).backgroundVisible !== 'false') throw new Error('Background debug toggle did not hide background');
      await snapshot(`${label}-02-default-background-off`, metres);
      await debugChange(async () => {
        await page.getByLabel('真实地理远处地形', { exact: true }).check();
        for (const name of ['林木', '建筑', '道路', 'Metro-North 站台']) await page.getByLabel(`真实地理${name}`, { exact: true }).uncheck();
      });
      if ((await read('地形覆盖诊断')).backgroundVisible !== 'true') throw new Error('Background did not restore');
      await snapshot(`${label}-03-ground-water-imagery`, metres);
      await debugChange(() => page.getByLabel('真实地表影像', { exact: true }).uncheck());
      if ((await read('真实航片准备诊断')).enabled !== 'false') throw new Error('Imagery debug toggle did not disable imagery');
      await snapshot(`${label}-04-ground-water-no-imagery`, metres);
    }
    health.runtimePassed = !health.console.some(item => ['error', 'pageerror'].includes(item.level)) && !health.requestFailures.length;
    if (!health.runtimePassed) process.exitCode = 1;
  } catch (error) {
    health.runtimePassed = false; health.failure = String(error.stack ?? error); process.exitCode = 1;
    if (page) {
      health.finalDiagnostic = await page.evaluate(() => Object.fromEntries(['真实地理加载状态', '地形覆盖诊断', '真实列车位置', '地理运动门控'].map(label => [label, document.querySelector(`[aria-label="${label}"]`)?.textContent]))).catch(() => ({}));
      await page.screenshot({ path: path.join(output, 'failure.png'), timeout: 15000 }).catch(() => {});
    }
  } finally {
    await fs.writeFile(path.join(output, 'health.json'), JSON.stringify(health, null, 2));
    await context?.close(); await browser?.close();
  }
})();
