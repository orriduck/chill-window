import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { GeoData } from './GeoData'
import type { RealWorld } from './RealWorld'
export interface GeoCommand { editing?: boolean; jump?: number; recenter?: boolean; time?: 'day' | 'dusk' | 'night'; weather?: 'clear' | 'rain' }
/** Same source-backed fantasy world in the map and passenger view. */
export class GeoInspector {
  readonly camera = new THREE.PerspectiveCamera(45, 1, 1, 18000)
  readonly controls: OrbitControls
  readonly layers = { ground: true, vegetation: true, groundcover: true, settlements: true, buildings: true, water: true, stations: true }
  private bar = document.createElement('section')
  private panel = document.createElement('section')
  private status = this.output('真实地理加载状态')
  private position = this.output('真实列车位置')
  private streaming = this.output('地理区块流式加载诊断')
  private coverage = this.output('地形覆盖诊断')
  private motion = this.output('地理运动门控')
  private performance = this.output('地理渲染性能')
  private game = this.output('游戏场景准备诊断')
  private mapPosition = this.output('地图检查位置')
  private preview = this.output('路线位置预览')
  private progress = document.createElement('input')
  private view: HTMLButtonElement
  private center: HTMLButtonElement
  private pending: GeoCommand = {}
  private data: GeoData | null = null
  private editing = false
  private error = ''
  private lastPointer = [0, 0]
  private ray = new THREE.Raycaster()
  private mapRevision = 0
  private mapControlActive = false
  private canvas: HTMLCanvasElement
  constructor(canvas: HTMLCanvasElement, initiallyReal: boolean) {
    this.canvas = canvas; this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enabled = false; this.controls.enableDamping = true; this.controls.dampingFactor = 0.12
    this.controls.screenSpacePanning = false; this.controls.minDistance = 12; this.controls.maxDistance = 7000
    this.controls.minPolarAngle = 0.06; this.controls.maxPolarAngle = Math.PI * 0.49
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }
    // Input handlers update the actual OrbitControls camera synchronously.
    // Publish those changes independently of potentially slow WebGL RAFs.
    this.controls.addEventListener('change', this.onMapChange)
    this.controls.addEventListener('start', this.onControlStart)
    this.controls.addEventListener('end', this.onControlEnd)
    const font = 'font:12px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;'
    this.bar.style.cssText = `position:fixed;left:14px;top:14px;right:14px;display:flex;flex-wrap:wrap;gap:7px;align-items:center;z-index:10004;pointer-events:none;color:#eee8d8;${font}`
    this.bar.setAttribute('aria-label', '地理世界工具栏')
    const title = document.createElement('span'); title.textContent = '哈德逊河 · 奇幻风景'; title.setAttribute('aria-label', '世界数据来源'); title.style.cssText = 'background:#21362de8;border:1px solid #8d957c55;border-radius:7px;padding:6px 10px;'
    this.view = this.button('俯视地图 · F5', () => { this.pending.editing = !this.editing }); this.center = this.button('回到列车附近', () => { this.pending.recenter = true })
    for (const e of [this.status, this.position]) e.style.cssText = 'background:#21362dc9;border-radius:7px;padding:6px 8px;font-size:10px;'
    this.bar.append(title, this.view, this.center, this.status, this.position)
    const credit = document.createElement('a'); credit.textContent = '© OpenStreetMap · Kenney CC0'; credit.href = 'https://www.openstreetmap.org/copyright'; credit.target = '_blank'; credit.rel = 'noopener noreferrer'; credit.style.cssText = 'position:fixed;bottom:7px;left:9px;font-size:9px;color:#eee8d8;pointer-events:auto;'; this.bar.append(credit)
    this.panel.setAttribute('aria-label', '真实路线检查'); this.panel.style.cssText = `position:fixed;right:14px;top:65px;bottom:20px;width:min(310px,calc(100vw - 28px));padding:16px;overflow:auto;border:1px solid #a9b29266;border-radius:10px;background:#f1efe4ee;color:#32442f;z-index:10004;${font}`
    const heading = document.createElement('strong'); heading.textContent = 'Hudson · 路线地图'
    const description = document.createElement('p'); description.textContent = '拖动平移，滚轮缩放，点击预览路线位置。应用后列车跳转；Esc 返回车窗。'
    const locations = document.createElement('select'); locations.setAttribute('aria-label', '真实路线地标')
    for (const [metres, label] of [[2790, '林间山坡'], [7393.844, '河岸开阔谷地'], [21083.216, 'Peekskill 村落']] as const) { const option = document.createElement('option'); option.value = String(metres); option.textContent = label; locations.append(option) }
    locations.onchange = () => { this.recenter(Number(locations.value)) }
    this.progress.type = 'range'; this.progress.min = '0'; this.progress.step = '0.001'; this.progress.style.width = '100%'; this.progress.setAttribute('aria-label', '真实路线里程'); this.progress.oninput = () => this.refreshPreview()
    const jump = this.button('列车跳到这个位置', () => { this.pending.jump = Number(this.progress.value) })
    const time = document.createElement('select'); time.setAttribute('aria-label', '地理检查时段')
    for (const [value, label] of [['day', '白天'], ['dusk', '黄昏'], ['night', '夜晚']]) { const option = document.createElement('option'); option.value = value; option.textContent = label; time.append(option) }
    time.onchange = () => { this.pending.time = time.value as GeoCommand['time'] }
    const weather = document.createElement('select'); weather.setAttribute('aria-label', '地理检查天气')
    for (const [value, label] of [['clear', '晴天'], ['rain', '雨天']]) { const option = document.createElement('option'); option.value = value; option.textContent = label; weather.append(option) }
    weather.onchange = () => { this.pending.weather = weather.value as GeoCommand['weather'] }
    const layers = document.createElement('div'); layers.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:12px 0;'
    for (const [key, name] of [['ground', '地表'], ['vegetation', '林木'], ['groundcover', '草灌木'], ['buildings', '村屋'], ['settlements', '道路'], ['water', '水域'], ['stations', '站台']] as const) { const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = true; input.setAttribute('aria-label', `真实地理${name}`); input.onchange = () => { this.layers[key] = input.checked }; label.append(input, document.createTextNode(name)); layers.append(label) }
    const source = document.createElement('p'); source.textContent = '真实路线、USGS 高程、水域、道路与建筑锚点；村屋比例、植被采样与手绘色彩为美术诠释。CC0 通用模型，不是当地逐栋立面或逐株调查。'; source.style.fontSize = '11px'
    const diagnostics = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = '准备与运行诊断'; diagnostics.append(summary, this.game, this.streaming, this.coverage, this.motion, this.performance)
    this.panel.append(heading, description, locations, this.progress, this.preview, jump, time, weather, layers, this.mapPosition, source, diagnostics)
    document.body.append(this.bar, this.panel); canvas.addEventListener('pointerdown', this.onDown); canvas.addEventListener('pointerup', this.onUp); this.bar.hidden = !initiallyReal; this.applyVisibility()
  }
  private output(label: string) { const e = document.createElement('output'); e.setAttribute('aria-label', label); e.style.cssText = 'display:block;white-space:pre-wrap;font-size:10px;margin:6px 0;overflow-wrap:anywhere;'; return e }
  private button(text: string, click: () => void) { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.style.cssText = 'pointer-events:auto;background:#e9e6d9;color:#344737;border:1px solid #95a08766;border-radius:6px;padding:6px 9px;font:inherit;margin-right:5px;'; b.onclick = click; return b }
  setData(data: GeoData) { this.data = data; this.progress.max = String(data.length); this.progress.value = String(data.checkpoints[0].s); this.refreshPreview(); this.applyVisibility() }
  fail(error: string) { this.error = error; this.status.textContent = `场景加载失败 · ${error}` }
  setEditing(editing: boolean, metres: number) { if (editing && !this.editing) this.recenter(metres); this.editing = editing; this.controls.enabled = editing && !!this.data; this.applyVisibility() }
  private applyVisibility() { this.panel.style.display = this.editing && this.data ? '' : 'none'; this.center.style.display = this.editing ? '' : 'none'; this.view.textContent = this.editing ? '返回列车 · Esc' : '俯视地图 · F5'; this.view.disabled = !this.data }
  resize(width: number, height: number) { this.camera.aspect = width / Math.max(height, 1); this.camera.updateProjectionMatrix() }
  recenter(s: number) { if (!this.data) return; this.progress.value = String(s); this.refreshPreview(); const p = this.data.pose(s), y = this.data.heightAt(p.x, p.z) ?? 0; const damping = this.controls.enableDamping; this.controls.enableDamping = false; this.controls.update(); this.controls.target.set(p.x, y, p.z); this.camera.position.set(p.x + p.dz * 650, y + 780, p.z - p.dx * 650 + 450); this.controls.update(); this.controls.enableDamping = damping }
  private refreshPreview() { if (!this.data) return; const p = this.data.pose(Number(this.progress.value)); this.preview.textContent = `${(p.s / 1000).toFixed(3)} km · ${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}` }
  update(s: number, world: RealWorld | null) {
    if (!this.data || !world) return
    this.controls.update(); const stream = world.streamingStats, terrain = world.terrainCoverageStats, pose = this.data.pose(s), a = world.gameAssets
    this.status.dataset.sceneFrame = String(stream.sceneFrame); this.status.textContent = this.error ? `场景加载失败 · ${this.error}` : `${terrain.readyTiles}/49 · ${stream.ready && !stream.pending ? '场景就绪' : '准备风景…'}`
    this.position.dataset.routeMetres = String(s); this.position.textContent = `${(s / 1000).toFixed(2)} / ${(this.data.length / 1000).toFixed(2)} km · ${pose.latitude.toFixed(5)}, ${pose.longitude.toFixed(5)}`
    Object.assign(this.coverage.dataset, { readyTiles: String(terrain.readyTiles), minTile: terrain.minTile.join(','), backgroundVisible: String(terrain.backgroundVisible) }); this.coverage.textContent = `背景64m / 细节8m · GPU覆盖 ${terrain.readyTiles}/49`
    Object.assign(this.streaming.dataset, { pendingGpu: String(stream.pendingGpu), visibleMissing: String(stream.visibleMissing) }); this.streaming.textContent = `缓存 ${stream.cached} · 可见 ${stream.visible}/49 · 预建 ${stream.prefetchPending}\n视野缺块 ${stream.visibleMissing} · 行驶缺块帧 ${stream.suddenAppearanceFrames}\n后续待上传 ${stream.pendingGpu} · ${stream.assets}`
    Object.assign(this.game.dataset, { style: 'fantasy', ready: String(a.readyState), loadedAssets: String(a.loadedAssets), assetBytes: String(a.assetBytes), houseDesigns: '3', placedHouses: String(a.housesPlaced), placedTrees: String(a.treesPlaced), placedGroundcover: String(a.groundcoverPlaced) }); this.game.textContent = `奇幻场景 · ${a.loadedAssets}/19 原始模型就绪\n3 村屋设计 · ${a.housesPlaced} 村屋 / ${a.treesPlaced} 林木 / ${a.groundcoverPlaced} 草灌木实例\n资源 ${(a.assetBytes / 1048576).toFixed(2)} MiB · CC0`
    this.mapPosition.dataset.sceneFrame = String(stream.sceneFrame)
    this.updateMapPosition()
  }
  setPerformance(fps: number, frameMs: number, submitMs: number, info: THREE.WebGLInfo) { Object.assign(this.performance.dataset, { fps: String(fps), frameMs: String(frameMs), submitMs: String(submitMs), drawCalls: String(info.render.calls), triangles: String(info.render.triangles), geometries: String(info.memory.geometries), textures: String(info.memory.textures) }); this.performance.textContent = `${fps} FPS · 帧 ${frameMs.toFixed(1)}ms · 提交 ${submitMs.toFixed(1)}ms\n${info.render.calls} 绘制 · ${info.render.triangles} 三角形` }
  setPresentation(stats: { submittedFrames: number; deferredFrames: number; held: boolean; lastSubmittedAt: number }, phase: string) {
    Object.assign(this.performance.dataset, { displayHeld: String(stats.held), submittedFrames: String(stats.submittedFrames), deferredFrames: String(stats.deferredFrames), lastSubmittedAt: String(stats.lastSubmittedAt), holdPhase: stats.held ? phase : 'none' })
    const lastActual = this.performance.textContent?.split('\n保持上一帧')[0] ?? ''
    this.performance.textContent = lastActual + (stats.held ? `\n保持上一帧 · GPU ${phase} · 已延后 ${stats.deferredFrames} 次提交` : '')
  }
  setMotionDiagnostic(requested: number, target: number, paused: boolean, inspection: boolean, ready: boolean, covered: boolean, jump: number | null) { this.motion.textContent = `请求/目标 ${requested.toFixed(1)}/${target.toFixed(1)}m/s · 暂停 ${paused} · 俯视 ${inspection}\n预热 ${ready} · 下一步覆盖 ${covered} · 跳转 ${jump ?? '无'}` }
  setGpuPreparation(s: { sequence: number; phase: string; groupIndex: number; groups: number; elapsedMs: number; completed: number }) { Object.assign(this.streaming.dataset, { gpuPhase: s.phase, gpuSequence: String(s.sequence), gpuCompleted: String(s.completed) }); this.streaming.textContent += `\nGPU ${s.phase} · 批次 ${s.sequence} · 完成 ${s.completed}` }
  setWorldPreparation(phase: string, presentable: boolean, elapsedMs: number) { Object.assign(this.streaming.dataset, { preparationPhase: phase, presentable: String(presentable), wholePrepareMs: String(elapsedMs) }) }
  setInitialPreparation(p: { gpuPhase: string; gpuSequence: number; gpuCompleted: number; pendingGpu: number; readyTiles: number; totalTiles: number; routeMetres: number; observedAtMs: number }) { Object.assign(this.streaming.dataset, { initialGpuPhase: p.gpuPhase, initialGpuSequence: String(p.gpuSequence), initialGpuCompleted: String(p.gpuCompleted), initialPendingGpu: String(p.pendingGpu), initialReadyTiles: String(p.readyTiles), initialTotalTiles: String(p.totalTiles), initialRouteMetres: String(p.routeMetres), initialReadyAtMs: String(p.observedAtMs) }) }
  markMapRendered() { this.mapPosition.dataset.renderedRevision = String(this.mapRevision) }
  private onControlStart = () => { this.mapControlActive = true; this.updateMapPosition() }
  private onControlEnd = () => { this.mapControlActive = false; this.updateMapPosition() }
  private onMapChange = () => { this.mapRevision++; this.updateMapPosition() }
  private updateMapPosition() {
    Object.assign(this.mapPosition.dataset, {
      x: String(this.focus.x), y: String(this.focus.y), z: String(this.focus.z),
      cameraX: String(this.camera.position.x), cameraY: String(this.camera.position.y), cameraZ: String(this.camera.position.z),
      quaternion: this.camera.quaternion.toArray().join(','), distance: String(this.camera.position.distanceTo(this.focus)),
      revision: String(this.mapRevision), controlsEnabled: String(this.controls.enabled), controlActive: String(this.mapControlActive),
    })
    this.mapPosition.textContent = `地图中心 ${this.focus.x.toFixed(1)}, ${this.focus.z.toFixed(1)}`
  }
  private onDown = (event: PointerEvent) => { this.lastPointer = [event.clientX, event.clientY] }
  private onUp = (event: PointerEvent) => { if (!this.editing || !this.data || event.button !== 0 || Math.hypot(event.clientX - this.lastPointer[0], event.clientY - this.lastPointer[1]) > 6) return; const rect = this.canvas.getBoundingClientRect(); this.ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), this.camera); const hit = new THREE.Vector3(); if (!this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.focus.y), hit)) return; this.progress.value = String(this.data.nearestRoute(hit.x, hit.z).s); this.refreshPreview() }
  get focus() { return this.controls.target }
  consume() { const p = this.pending; this.pending = {}; return p }
  dispose() { this.controls.removeEventListener('change', this.onMapChange); this.controls.removeEventListener('start', this.onControlStart); this.controls.removeEventListener('end', this.onControlEnd); this.controls.dispose(); this.canvas.removeEventListener('pointerdown', this.onDown); this.canvas.removeEventListener('pointerup', this.onUp); this.bar.remove(); this.panel.remove() }
}
