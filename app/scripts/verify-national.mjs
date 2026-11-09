import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.env.CHILL_URL || 'http://127.0.0.1:4180'
const dir = process.env.CHILL_EVIDENCE_DIR || '/tmp/chill-national-evidence'
await mkdir(dir, { recursive: true })
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--mute-audio', '--disable-background-timer-throttling'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block' })
await context.addInitScript(() => {
  window.__audioAttempts = 0
  window.addEventListener('chill:preparation', event => { window.__hudsonPreparation = event.detail })
  for (const key of ['AudioContext', 'webkitAudioContext']) if (window[key]) window[key] = new Proxy(window[key], { construct() { window.__audioAttempts++; throw new Error('Audio is forbidden during silent verification') } })
  HTMLMediaElement.prototype.play = function () { window.__audioAttempts++; return Promise.reject(new Error('Media playback blocked')) }
})
const page = await context.newPage()
const errors = [], warnings = [], routeRequests = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); if (message.type() === 'warning') warnings.push(message.text()) })
page.on('request', request => { if (request.url().includes('/rail/rides/')) routeRequests.push(request.url()) })
const report = { url: base, browser: await browser.version(), viewport: [1440, 1000], checks: [], snapshots: [], errors, warnings, audioAttempts: 0 }
async function check(name, callback) { await callback(); report.checks.push({ name, passed: true }) }
async function screenshot(name) { await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true }); report.snapshots.push(name) }
async function ready() { await page.waitForFunction(() => window.__railRide?.snapshot().ready, null, { timeout: 30000 }) }
async function snap() { return page.evaluate(() => window.__railRide.snapshot()) }
try {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.querySelectorAll('.atlas-route').length > 40)
  await check('atlas loads 49 official route records', async () => { if (await page.locator('.atlas-route').count() !== 50) throw new Error('wrong route count'); if (!(await page.title()).includes('Window Seat')) throw new Error('wrong title') })
  await check('route geometry is lazy loaded', async () => { if (routeRequests.length) throw new Error('all-route geometry fetched before selection') })
  await screenshot('01-national-atlas')
  await page.getByRole('textbox', { name: '搜索铁路路线' }).fill('California Zephyr')
  await page.getByRole('button', { name: /California Zephyr/ }).click()
  await page.getByRole('button', { name: '选个靠窗位' }).click()
  await ready()
  await check('selected real route starts paused with bounded scenery', async () => { const s = await snap(); if (!s.paused || s.tiles > 20 || s.drawCalls < 1 || s.lengthMetres < 1000) throw new Error(JSON.stringify(s)); if (await page.locator('canvas').count() !== 1) throw new Error('multiple renderer canvases') })
  report.initialRide = await snap(); await screenshot('02-zephyr-window')
  await page.getByRole('button', { name: '出发', exact: true }).click(); await page.waitForTimeout(3500)
  await check('ride and focus clock advance, then pause together', async () => { const moving = await snap(); if (moving.distanceMetres < 30 || moving.paused || moving.focusRemainingSeconds > 1498) throw new Error('train or focus clock did not advance'); report.movingRide = moving; await page.getByRole('button', { name: '暂停', exact: true }).click(); await page.waitForTimeout(300); const s = await snap(); await page.waitForTimeout(500); const paused = await snap(); if (paused.distanceMetres !== s.distanceMetres || paused.focusRemainingSeconds !== s.focusRemainingSeconds) throw new Error('paused train or focus clock moved') })
  await page.getByRole('button', { name: '俯瞰路线' }).click(); await page.waitForTimeout(250); await screenshot('03-zephyr-route-overview'); await page.getByRole('button', { name: '回到车窗' }).click()
  await page.getByRole('slider', { name: '路线里程' }).fill(String(Math.floor((await snap()).lengthMetres * .53))); await page.waitForTimeout(300)
  await check('distant seek keeps finite position and bounded tile pool', async () => { const s = await snap(); if (!Number.isFinite(s.longitude) || s.distanceMetres < s.lengthMetres * .5 || s.tiles > 20) throw new Error('bad distant seek') })
  await page.getByRole('slider', { name: '路线里程' }).focus(); await page.getByRole('slider', { name: '路线里程' }).press('End'); await page.waitForTimeout(200); await screenshot('09-component-end')
  await check('component ends exactly without joining another branch', async () => { const s = await snap(); if (!s.paused || Math.abs(s.distanceMetres - s.lengthMetres) > .001) throw new Error('end boundary failed') })
  await page.getByRole('button', { name: '反向乘坐' }).click(); await ready(); await check('reverse rebuilds one paused renderer', async () => { if (!(await snap()).paused || await page.locator('canvas').count() !== 1) throw new Error('reverse did not reset safely') })
  await page.getByRole('combobox', { name: '生成景观风格' }).selectOption('desert'); await ready(); await screenshot('04-generated-desert')
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(250); await screenshot('05-mobile-window')
  await check('mobile controls stay within viewport', async () => { if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('mobile overflow'); const box = await page.getByRole('button', { name: '出发', exact: true }).boundingBox(); if (!box || box.y + box.height > 844) throw new Error('departure button clipped') })
  await page.getByRole('button', { name: '结束并换路线' }).click(); await page.waitForFunction(() => document.querySelectorAll('.atlas-route').length > 40); await screenshot('06-mobile-atlas')
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.getByRole('button', { name: /Coast Starlight/ }).click(); await page.getByRole('button', { name: '选个靠窗位' }).click(); await ready(); await screenshot('07-coast-window')
  await check('switching official routes leaves one canvas', async () => { if (await page.locator('canvas').count() !== 1) throw new Error('renderer not disposed') })
  await check('graphics context failure exposes retry and recovers', async () => {
    await page.locator('canvas').evaluate(canvas => { const gl = canvas.getContext('webgl2'); const extension = gl?.getExtension('WEBGL_lose_context'); if (!extension) throw new Error('context loss extension unavailable'); extension.loseContext() })
    await page.getByRole('alert').waitFor({ state: 'visible' }); await page.getByRole('button', { name: '重新加载', exact: true }).click(); await ready()
    if (await page.locator('canvas').count() !== 1) throw new Error('retry leaked renderer')
  })
  await page.getByRole('button', { name: '结束并换路线' }).click(); await page.waitForFunction(() => document.querySelectorAll('.atlas-route').length > 40)
  await page.getByRole('button', { name: '选个靠窗位' }).click()
  await page.waitForFunction(() => window.__hudsonPreparation?.presentable === true, null, { timeout: 30000 })
  report.hudsonPreparation = await page.evaluate(() => window.__hudsonPreparation)
  await page.waitForTimeout(1200); await screenshot('08-hudson-detailed')
  await check('silent HUDson boarding creates no audio context', async () => { await page.getByRole('button', { name: 'Board train', exact: true }).click(); await page.waitForTimeout(800); if (await page.evaluate(() => window.__audioAttempts) !== 0) throw new Error('audio attempted') })
  report.audioAttempts = await page.evaluate(() => window.__audioAttempts)
  if (errors.length || report.audioAttempts) throw new Error(errors.join('\n') || 'audio was attempted')
  report.passed = true
} catch (error) { report.passed = false; report.failure = String(error); await page.screenshot({ path: `${dir}/failure.png`, fullPage: true }).catch(() => {}) }
finally { await writeFile(`${dir}/verification.json`, JSON.stringify(report, null, 2)); await browser.close() }
console.log(JSON.stringify({ passed: report.passed, checks: report.checks, audioAttempts: report.audioAttempts, errors, failure: report.failure, evidence: dir }, null, 2))
if (!report.passed) process.exitCode = 1
