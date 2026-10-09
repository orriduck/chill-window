import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { GeoData } from './GeoData'
import type { RealWorld } from './RealWorld'

export interface GeoCommand { editing?: boolean; jump?: number; recenter?: boolean; time?: 'day' | 'night'; weather?: 'clear' | 'rain' }
/** Geographic inspection uses the ride's actual data and has no synthetic
 * scene selector. The progress control changes the train only on Apply. */
export class GeoInspector {
  readonly camera = new THREE.PerspectiveCamera(45, 1, 1, 18000)
  readonly controls: OrbitControls
  private bar = document.createElement('section')
  private panel = document.createElement('section')
  private status = document.createElement('output')
  private position = document.createElement('output')
  private attribution = document.createElement('a')
  private source = document.createElement('span')
  private view: HTMLButtonElement
  private center: HTMLButtonElement
  private progress = document.createElement('input')
  private checkpoint = document.createElement('select')
  private jump: HTMLButtonElement
  private time = document.createElement('select')
  private weather = document.createElement('select')
  readonly layers = { ground: true, vegetation: true, settlements: true, water: true, farmland: true }
  private pending: GeoCommand = {}
  private data: GeoData | null = null
  private real = true
  private editing = false
  private error = ''
  private readout = document.createElement('output')
  private lastPointer: [number, number] = [0, 0]
  private canvas: HTMLCanvasElement
  private ray = new THREE.Raycaster()
  constructor(canvas: HTMLCanvasElement, initiallyReal: boolean) {
    this.canvas = canvas
    this.real = initiallyReal
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enabled = false; this.controls.enableDamping = true; this.controls.dampingFactor = 0.12
    this.controls.screenSpacePanning = false; this.controls.minDistance = 100; this.controls.maxDistance = 7000
    this.controls.minPolarAngle = 0.06; this.controls.maxPolarAngle = Math.PI * 0.43
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }
    const font = 'font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;'
    this.bar.style.cssText = `position:fixed;left:18px;top:18px;right:18px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;z-index:10004;pointer-events:none;${font}`
    this.bar.setAttribute('aria-label', '地理世界工具栏')
    this.source.setAttribute('aria-label', '世界数据来源')
    this.source.style.cssText = 'pointer-events:auto;border:1px solid #d8dccb;border-radius:6px;padding:7px 10px;background:#f1efe4;color:#32442f;font:inherit;'
    this.source.textContent = '真实路线 · 哈德逊河'
    this.view = this.button('俯视调试 · F5', () => { this.pending.editing = !this.editing })
    this.center = this.button('回到列车附近', () => { this.pending.recenter = true })
    this.status.setAttribute('aria-label', '真实地理加载状态')
    this.status.style.cssText = 'background:#243829e8;color:#f3f0e5;border-radius:6px;padding:7px 10px;font-size:11px;'
    this.position.setAttribute('aria-label', '真实列车位置')
    this.position.style.cssText = 'background:#243829e8;color:#f3f0e5;border-radius:6px;padding:7px 10px;font-size:11px;'
    const attribution = this.attribution; attribution.href = 'https://www.openstreetmap.org/copyright'
    attribution.textContent = '© OpenStreetMap contributors'; attribution.target = '_blank'; attribution.rel = 'noopener noreferrer'
    attribution.style.cssText = 'pointer-events:auto;padding:5px 8px;background:#243829c9;color:#f3f0e5;font-size:10px;border-radius:5px;'
    this.bar.append(this.source, this.view, this.center, this.status, this.position, attribution)
    this.panel.setAttribute('aria-label', '真实路线检查')
    this.panel.style.cssText = `position:fixed;right:18px;top:76px;width:270px;max-width:calc(100vw - 36px);padding:18px;background:#f1efe4f5;color:#2b3a2e;border:1px solid #d8d7c5;border-radius:9px;box-shadow:0 10px 36px #13281930;z-index:10003;display:none;${font}`
    const title = document.createElement('strong'); title.textContent = 'Empire Service · 南行'
    const description = document.createElement('p'); description.textContent = '同一份真实地理数据 · 拖动平移 / 滚轮缩放 / 右键旋转。点击地面定位最近线路里程。'; description.style.cssText = 'font-size:11px;color:#697566;margin:8px 0 14px;'
    this.checkpoint.setAttribute('aria-label', '真实路线片段'); this.checkpoint.style.cssText = this.source.style.cssText + 'width:100%;'
    this.checkpoint.onchange = () => { this.progress.value = this.checkpoint.value; this.refreshPreview(); if (this.data) this.recenter(Number(this.progress.value)) }
    this.progress.type = 'range'; this.progress.min = '0'; this.progress.max = '1'; this.progress.step = 'any'
    this.progress.setAttribute('aria-label', '真实路线里程'); this.progress.style.cssText = 'display:block;width:100%;accent-color:#536d4f;margin:14px 0 6px;'
    this.progress.oninput = () => { this.refreshPreview() }
    this.readout.setAttribute('aria-label', '选中真实路线位置'); this.readout.style.cssText = 'display:block;font-size:11px;margin:0 0 10px;color:#62715d;'
    this.jump = this.button('列车跳到这个位置', () => { this.pending.jump = Number(this.progress.value) })
    this.jump.style.cssText += 'width:100%;background:#4d684a;color:#f5f1e3;'
    for (const [element, label, values] of [[this.time, '地理检查时段', [['day', '白天'], ['night', '夜晚']]], [this.weather, '地理检查天气', [['clear', '晴天'], ['rain', '雨天']]]] as const) {
      element.setAttribute('aria-label', label); element.style.cssText = this.source.style.cssText + 'margin-top:12px;margin-right:8px;'
      for (const [value, text] of values) { const option = document.createElement('option'); option.value = value; option.textContent = text; element.append(option) }
    }
    this.time.onchange = () => { this.pending.time = this.time.value as 'day' | 'night' }
    this.weather.onchange = () => { this.pending.weather = this.weather.value as 'clear' | 'rain' }
    const notes = document.createElement('p'); notes.textContent = '地形：USGS 3DEP，约 20m 采样。轨面/水位为可视化近似；建筑高度来自标签或估计。原始地理数据只读。'; notes.style.cssText = 'font-size:11px;color:#697566;margin:14px 0 8px;'
    const credits = document.createElement('div'); credits.style.cssText = 'font-size:11px;display:flex;gap:10px;'
    for (const [name, url] of [['FRA / Amtrak', 'https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_Amtrak_Routes/FeatureServer/0'], ['USGS', 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer'], ['© OSM contributors', 'https://www.openstreetmap.org/copyright']]) {
      const link = document.createElement('a'); link.textContent = name; link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.style.color = '#506b51'; credits.append(link)
    }
    const layers = document.createElement('div'); layers.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;font-size:11px;margin:10px 0;'
    for (const [key, name] of [['ground', '地表'], ['vegetation', '林木'], ['settlements', '建筑 / 道路'], ['water', '水域']] as const) {
      const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = true
      input.setAttribute('aria-label', `真实地理${name}`); input.onchange = () => { this.layers[key] = input.checked }
      label.append(input, document.createTextNode(name)); layers.append(label)
    }
    this.panel.append(title, description, layers, this.checkpoint, this.progress, this.readout, this.jump, this.time, this.weather, notes, credits)
    document.body.append(this.bar, this.panel)
    canvas.addEventListener('pointerdown', this.onDown); canvas.addEventListener('pointerup', this.onUp)
    this.applyVisibility()
  }
  private button(text: string, action: () => void) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.onclick = action
    button.style.cssText = 'pointer-events:auto;border:1px solid #d8dccb;border-radius:6px;padding:7px 10px;background:#f1efe4;color:#32442f;font:inherit;cursor:pointer;'
    return button
  }
  setData(data: GeoData) {
    this.data = data
    this.progress.max = String(data.length); this.progress.value = String(data.checkpoints[0].s)
    for (const point of data.checkpoints) { const option = document.createElement('option'); option.value = String(point.s); option.textContent = point.label; this.checkpoint.append(option) }
    this.refreshPreview(); this.applyVisibility()
  }
  fail(message: string) { this.error = message; this.applyVisibility() }
  setReal(value: boolean) { this.real = value; this.applyVisibility() }
  setEditing(value: boolean, s: number) {
    if (value !== this.editing && value && this.real && this.data) { this.progress.value = String(s); this.recenter(s); this.refreshPreview() }
    this.editing = value; this.controls.enabled = value && this.real && !!this.data; this.applyVisibility()
  }
  private applyVisibility() {
    this.attribution.style.display = this.real ? '' : 'none'
    for (const element of [this.view, this.status, this.position]) element.style.display = this.real ? '' : 'none'
    this.center.style.display = this.real && this.editing ? '' : 'none'
    this.panel.style.display = this.real && this.editing && !!this.data ? '' : 'none'
    this.view.textContent = this.editing ? '返回列车 · Esc' : '俯视调试 · F5'
    this.view.disabled = this.center.disabled = !this.data
    if (this.real && !this.data) this.status.textContent = this.error ? `真实数据加载失败 · ${this.error}` : '正在加载真实路线 / 高程 / 地物…'
  }
  resize(width: number, height: number) { this.camera.aspect = width / Math.max(1, height); this.camera.updateProjectionMatrix() }
  recenter(s: number) {
    if (!this.data) return
    this.progress.value = String(s); this.refreshPreview()
    const pose = this.data.pose(s), y = this.data.heightAt(pose.x, pose.z) ?? 0
    const damping = this.controls.enableDamping; this.controls.enableDamping = false; this.controls.update()
    this.controls.target.set(pose.x, y, pose.z); this.camera.position.set(pose.x + pose.dz * 1100, y + 1250, pose.z - pose.dx * 1100 + 850)
    this.controls.update(); this.controls.enableDamping = damping
  }
  update(s: number, world: RealWorld | null) {
    if (!this.real || !this.data || !world) return
    if (this.editing) this.controls.update()
    const pose = this.data.pose(s)
    this.status.textContent = `${world.chunkCount}/6 详细区块 · DEM 20m · 模型 ${world.assetStatus}${world.pending ? ' · 加载区块中' : ''}`
    this.position.textContent = `${(pose.s / 1000).toFixed(2)} / ${(this.data.length / 1000).toFixed(2)} km · ${pose.latitude.toFixed(5)}, ${pose.longitude.toFixed(5)}${s >= this.data.length - 0.01 ? ' · 样板终点' : ''}`
  }
  private refreshPreview() {
    if (!this.data) return
    const pose = this.data.pose(Number(this.progress.value))
    this.readout.textContent = `${(pose.s / 1000).toFixed(2)} km · ${pose.latitude.toFixed(5)}, ${pose.longitude.toFixed(5)}`
  }
  private onDown = (event: PointerEvent) => { this.lastPointer = [event.clientX, event.clientY] }
  private onUp = (event: PointerEvent) => {
    if (!this.real || !this.editing || !this.data || event.button !== 0 || Math.hypot(event.clientX - this.lastPointer[0], event.clientY - this.lastPointer[1]) > 6) return
    const rect = this.canvas.getBoundingClientRect()
    this.ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), this.camera)
    const hit = new THREE.Vector3()
    if (!this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.controls.target.y), hit)) return
    this.progress.value = String(this.data.nearestRoute(hit.x, hit.z).s); this.refreshPreview()
  }
  get focus() { return this.controls.target }
  consume() { const result = this.pending; this.pending = {}; return result }
  dispose() { this.controls.dispose(); this.canvas.removeEventListener('pointerdown', this.onDown); this.canvas.removeEventListener('pointerup', this.onUp); this.bar.remove(); this.panel.remove() }
}
