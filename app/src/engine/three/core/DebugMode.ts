import * as THREE from 'three'
import { terrainFootprint } from '../terrain/TerrainFootprint'
import type { PassengerView } from './PassengerView'
import type { CarriageDebugPart } from '../interior/WindowFrame'

const CHUNK_SIZE = 256

/**
 * Unified debug mode with HUD overlay.
 *
 * Keys:
 *   F2  — toggle the seated-coach inspection panel
 *   F3  — cycle HUD: off → perf only → full debug → off
 *   F4  — trigger the station arrival motion probe
 *   F5  — enter / exit the independent terrain editor camera
 *   Esc — return to the train from terrain editing
 *   F6  — toggle scene-hidden mode (hide everything but window frame)
 *   F7  — toggle terrain surface-mask diagnostics
 *   F8  — freeze / resume terrain streaming
 *   F9/F10/F11 — jump to the planned town, lakeshore, or mountain debug probes
 *   F12 — fixed daytime grass inspection probe (clear weather, stopped train)
 */
export class DebugMode {
  // ---- HUD level ----
  // 0 = off, 1 = perf only, 2 = full debug
  hudLevel = 0

  // ---- State ----
  topDown = false
  private geographic = false
  onTerrainEditingChange: (active: boolean) => void = () => {}
  sceneHidden = false
  terrainDebugView: 0 | 1 = 0
  streamingFrozen = false
  grassProbe = false
  carriageInspectorVisible = false
  private jumpTarget: number | null = null
  private stationProbeRequested = false
  private scenePreset: string | null = null
  private speedPreset: number | null = null
  private speedSelect: HTMLSelectElement | null = null
  private motionReadout: HTMLOutputElement | null = null
  private passengerView: PassengerView | null = null

  // ---- HUD DOM ----
  private hudEl: HTMLDivElement
  private carriageInspectorEl: HTMLDivElement
  private carriagePartController: ((part: CarriageDebugPart, visible: boolean) => void) | null = null
  private carriagePartInputs = new Map<CarriageDebugPart, HTMLInputElement>()
  private exteriorInput: HTMLInputElement | null = null
  private carriagePartVisibility: Record<CarriageDebugPart, boolean> = {
    shell: true,
    seats: true,
    fixtures: true,
    glass: true,
    lighting: true,
    hud: true,
  }

  // ---- Saved camera state for top-down toggle ----
  private savedPos = new THREE.Vector3()
  private savedQuat = new THREE.Quaternion()
  private savedFov = 70

  // ---- Boundary line overlay (biome + chunk) ----
  private boundaryGroup = new THREE.Group()
  private biomeLines: THREE.LineSegments | null = null
  private chunkLines: THREE.LineSegments | null = null

  // ---- Exterior group for scene-hidden toggle ----
  exteriorGroup: THREE.Group | null = null

  // ---- PerfMonitor reference (external, wired in ThreeCanvas) ----
  perfMonitor: { show(): void; hide(): void; isVisible: boolean } | null = null

  constructor() {
    this.hudEl = document.createElement('div')
    this.hudEl.style.cssText = `
      position: fixed; top: 40px; left: 8px; z-index: 10000;
      background: rgba(0,0,0,0.82); color: #0f0; font: 11px/1.5 monospace;
      padding: 10px 12px; border-radius: 6px; pointer-events: none;
      display: none; white-space: pre; min-width: 280px;
    `
    document.body.appendChild(this.hudEl)
    this.carriageInspectorEl = this.createCarriageInspector()
    document.body.appendChild(this.carriageInspectorEl)
    if (new URLSearchParams(window.location.search).has('debugCarriage')) {
      this.carriageInspectorVisible = true
      this.carriageInspectorEl.style.display = 'block'
    }
    window.addEventListener('keydown', this.onKey)
  }

  attachCarriageInspector(controller: (part: CarriageDebugPart, visible: boolean) => void) {
    this.carriagePartController = controller
    for (const [part, visible] of Object.entries(this.carriagePartVisibility)) {
      controller(part as CarriageDebugPart, visible)
    }
  }

  /** Register the scene and the exterior group that scene-hidden mode toggles. */
  init(scene: THREE.Scene, exteriorGroup: THREE.Group) {
    this.exteriorGroup = exteriorGroup
    this.boundaryGroup.visible = false
    scene.add(this.boundaryGroup)
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.repeat) return
    // Mode shortcuts remain available while a terrain slider is focused.
    if (e.key === 'F5') {
      e.preventDefault()
      this.setTerrainEditing(!this.topDown)
      return
    }
    if (e.key === 'Escape' && this.topDown) {
      e.preventDefault()
      this.setTerrainEditing(false)
      return
    }
    // Only handle if not typing in an input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

    switch (e.key) {
      case 'F2':
        e.preventDefault()
        this.carriageInspectorVisible = !this.carriageInspectorVisible
        this.carriageInspectorEl.style.display = this.carriageInspectorVisible ? 'block' : 'none'
        break
      case 'F3':
        e.preventDefault()
        this.cycleHud()
        break
      case 'F4':
        e.preventDefault()
        this.stationProbeRequested = true
        break
      case 'F6':
        e.preventDefault()
        this.toggleSceneHidden()
        break
      case 'F7':
        e.preventDefault()
        this.terrainDebugView = this.terrainDebugView === 0 ? 1 : 0
        break
      case 'F8':
        e.preventDefault()
        this.streamingFrozen = !this.streamingFrozen
        break
      case 'F9':
        e.preventDefault()
        this.jumpTarget = 3400
        break
      case 'F10':
        e.preventDefault()
        this.jumpTarget = 5450
        break
      case 'F11':
        e.preventDefault()
        this.jumpTarget = 6400
        break
      case 'F12':
        e.preventDefault()
        this.grassProbe = !this.grassProbe
        break
    }
  }

  // ---- HUD cycling ----

  private cycleHud() {
    this.hudLevel = (this.hudLevel + 1) % 3

    switch (this.hudLevel) {
      case 0: // off
        this.perfMonitor?.hide()
        this.hudEl.style.display = 'none'
        this.boundaryGroup.visible = false
        break
      case 1: // perf only
        this.perfMonitor?.show()
        this.hudEl.style.display = 'none'
        this.boundaryGroup.visible = false
        break
      case 2: // full debug
        this.perfMonitor?.hide()
        this.hudEl.style.display = 'block'
        this.boundaryGroup.visible = !this.geographic
        break
    }
  }

  setGeographic(active: boolean) {
    this.geographic = active
    this.boundaryGroup.visible = !active && this.hudLevel === 2
    for (const element of this.carriageInspectorEl.querySelectorAll<HTMLElement>('[data-synthetic-preset]')) element.style.display = active ? 'none' : ''
  }

  // ---- Toggles ----

  setTerrainEditing(active: boolean) {
    if (active === this.topDown) return
    this.topDown = active
    this.carriageInspectorVisible = false
    this.carriageInspectorEl.style.display = 'none'
    // A prior isolated-carriage or frozen-streaming probe must not hide the
    // editor or prevent its neighbourhood from loading.
    this.sceneHidden = false
    if (this.exteriorGroup) this.exteriorGroup.visible = true
    if (this.exteriorInput) this.exteriorInput.checked = true
    this.streamingFrozen = false
    if (!active) {
      this.terrainDebugView = 0
      this.hudLevel = 0
      this.perfMonitor?.hide()
      this.hudEl.style.display = 'none'
      this.boundaryGroup.visible = false
    }
    this.onTerrainEditingChange(active)
  }

  private toggleSceneHidden() {
    this.sceneHidden = !this.sceneHidden
    if (this.exteriorGroup) {
      this.exteriorGroup.visible = !this.sceneHidden
    }
    if (this.exteriorInput) this.exteriorInput.checked = !this.sceneHidden
  }

  private createCarriageInspector() {
    const panel = document.createElement('div')
    panel.dataset.carriageDebugPanel = 'true'
    panel.style.cssText = `
      position: fixed; top: 52px; right: 16px; z-index: 10001;
      width: 218px; padding: 14px 14px 12px;
      border: 1px solid rgba(255,255,255,0.18); border-radius: 10px;
      background: rgba(24, 23, 20, 0.9); color: #f4efe3;
      box-shadow: 0 16px 48px rgba(28, 19, 12, 0.3);
      backdrop-filter: blur(14px); font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      pointer-events: auto; display: none;
    `

    const title = document.createElement('div')
    title.textContent = '窗边软座 · 场景检查'
    title.style.cssText = 'font: 700 13px/1.2 ui-sans-serif, system-ui, sans-serif; letter-spacing: .02em;'
    panel.appendChild(title)
    const subtitle = document.createElement('div')
    subtitle.textContent = '面对面坐席 / 材质与窗景 · F2'
    subtitle.style.cssText = 'margin: 4px 0 10px; color: rgba(244,239,227,.62); font-size: 10px;'
    panel.appendChild(subtitle)

    const viewLabel = document.createElement('label')
    viewLabel.textContent = '乘客眼位 '
    viewLabel.style.cssText = 'display:flex;align-items:center;gap:8px;margin:10px 0;'
    const viewSelect = document.createElement('select')
    viewSelect.setAttribute('aria-label', '乘客眼位')
    viewSelect.style.cssText = 'min-width:0;flex:1;background:#343b36;color:#f4efe3;border:1px solid #ffffff30;border-radius:4px;padding:5px;'
    for (const [value, text] of [['window', '靠窗座位'], ['aisle', '原走道眼位'], ['seats', '座面与窗墙间隙']]) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = text
      viewSelect.appendChild(option)
    }
    viewSelect.addEventListener('change', () => { this.passengerView = viewSelect.value as PassengerView })
    viewLabel.appendChild(viewSelect)
    panel.appendChild(viewLabel)

    const options: [CarriageDebugPart | 'exterior', string][] = [
      ['exterior', '窗外场景'],
      ['shell', '车体与窗框'],
      ['seats', '软座、桌面与窗帘'],
      ['fixtures', '行李架与设备'],
      ['glass', '玻璃与反射'],
      ['lighting', '车内灯光'],
      ['hud', '旅程信息条'],
    ]
    for (const [part, labelText] of options) {
      const label = document.createElement('label')
      label.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;user-select:none;'
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.checked = true
      input.style.accentColor = '#9c4055'
      label.append(input, document.createTextNode(labelText))
      panel.appendChild(label)
      if (part === 'exterior') {
        this.exteriorInput = input
        input.addEventListener('change', () => {
          this.sceneHidden = !input.checked
          if (this.exteriorGroup) this.exteriorGroup.visible = input.checked
        })
      } else {
        this.carriagePartInputs.set(part, input)
        input.addEventListener('change', () => {
          this.carriagePartVisibility[part] = input.checked
          this.carriagePartController?.(part, input.checked)
        })
      }
    }

    const buttons = document.createElement('div')
    buttons.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px;'
    const cabinOnly = document.createElement('button')
    cabinOnly.type = 'button'
    cabinOnly.textContent = '只看车厢'
    const reset = document.createElement('button')
    reset.type = 'button'
    reset.textContent = '全部恢复'
    for (const button of [cabinOnly, reset]) {
      button.style.cssText = `
        border:1px solid rgba(255,255,255,.16);border-radius:6px;padding:6px 8px;
        background:rgba(255,255,255,.06);color:inherit;font:inherit;cursor:pointer;
      `
    }
    cabinOnly.addEventListener('click', () => {
      this.sceneHidden = true
      if (this.exteriorGroup) this.exteriorGroup.visible = false
      if (this.exteriorInput) this.exteriorInput.checked = false
    })
    reset.addEventListener('click', () => {
      this.sceneHidden = false
      if (this.exteriorGroup) this.exteriorGroup.visible = true
      if (this.exteriorInput) this.exteriorInput.checked = true
      for (const part of Object.keys(this.carriagePartVisibility) as CarriageDebugPart[]) {
        this.carriagePartVisibility[part] = true
        const input = this.carriagePartInputs.get(part)
        if (input) input.checked = true
        this.carriagePartController?.(part, true)
      }
    })
    buttons.append(cabinOnly, reset)
    panel.appendChild(buttons)
    const presets = document.createElement('div')
    presets.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:12px;'
    for (const [id, label] of [['field', '湖州塘田原型'], ['forest', '林间行驶'], ['lake', '湖畔远山'], ['mountain', '山地铁路'], ['rain', '雨天窗边'], ['night', '夜间软座']]) {
      const button = document.createElement('button')
      button.textContent = label
      if (id !== 'rain' && id !== 'night') button.dataset.syntheticPreset = 'true'
      button.type = 'button'
      button.style.cssText = 'padding:7px 4px;border:1px solid #ffffff28;border-radius:5px;background:#ffffff0d;color:inherit;cursor:pointer;'
      button.addEventListener('click', () => {
        this.scenePreset = id
        if (this.speedSelect) this.speedSelect.value = '160'
      })
      presets.appendChild(button)
    }
    panel.appendChild(presets)
    const terrainEntry = document.createElement('button')
    terrainEntry.type = 'button'
    terrainEntry.textContent = '打开六区块地形编辑器'
    terrainEntry.style.cssText = 'width:100%;margin-top:10px;padding:8px;background:#49604b;color:#f4efe3;border:1px solid #ffffff30;border-radius:5px;cursor:pointer;'
    terrainEntry.onclick = () => {
      this.setTerrainEditing(true)
    }
    panel.appendChild(terrainEntry)
    const speedLabel = document.createElement('label')
    speedLabel.textContent = '速度对比（km/h） '
    const speed = document.createElement('select')
    this.speedSelect = speed
    speed.setAttribute('aria-label', '速度对比')
    speed.style.cssText = viewSelect.style.cssText
    for (const kmh of [160, 80, 54, 0]) {
      const option = document.createElement('option')
      option.value = String(kmh)
      option.textContent = kmh === 54 ? '54 · 原移动速度' : String(kmh)
      speed.appendChild(option)
    }
    speed.onchange = () => { this.speedPreset = Number(speed.value) }
    speedLabel.style.cssText = 'display:flex;gap:6px;margin-top:12px;'
    speedLabel.appendChild(speed)
    panel.appendChild(speedLabel)
    this.motionReadout = document.createElement('output')
    this.motionReadout.setAttribute('aria-label', '实测行驶')
    this.motionReadout.style.cssText = 'display:block;white-space:pre-line;margin-top:10px;font-size:10px;color:#cfdfc3;'
    panel.appendChild(this.motionReadout)
    return panel
  }

  /** Whether the debug camera should override the normal camera. */
  get isTopDown(): boolean {
    return this.topDown
  }

  consumeSpeedPreset(): number | null {
    const speed = this.speedPreset
    this.speedPreset = null
    return speed
  }

  updateMotion(z: number, speed: number, measured: number) {
    if (this.motionReadout && this.carriageInspectorVisible) {
      this.motionReadout.textContent = `里程 ${z.toFixed(1)} m · 速度 ${(speed * 3.6).toFixed(0)} km/h\n实测 ${measured.toFixed(1)} m/s · 50 m 杆距 ${speed > 0.1 ? (50 / speed).toFixed(2) + ' s' : '—'}`
    }
  }

  consumePassengerView(): PassengerView | null {
    const view = this.passengerView
    this.passengerView = null
    return view
  }

  consumeScenePreset(): string | null {
    const preset = this.scenePreset
    this.scenePreset = null
    return preset
  }

  consumeJumpTarget(): number | null {
    const target = this.jumpTarget
    this.jumpTarget = null
    return target
  }

  consumeStationProbe(): boolean {
    const requested = this.stationProbeRequested
    this.stationProbeRequested = false
    return requested
  }

  // ---- Camera override for top-down view ----

  /** Call before entering top-down — saves normal camera state. */
  enterTopDown(cam: THREE.PerspectiveCamera) {
    this.savedPos.copy(cam.position)
    this.savedQuat.copy(cam.quaternion)
    this.savedFov = cam.fov
  }

  /** Override camera to top-down view.  Call AFTER camera.update() so Z position is fresh. */
  applyTopDown(cam: THREE.PerspectiveCamera) {
    cam.position.set(120, 260, cam.position.z)
    cam.lookAt(120, 0, cam.position.z + 20)
    cam.fov = 45
    cam.updateProjectionMatrix()
  }

  /** Call when leaving top-down — restores normal camera. */
  exitTopDown(cam: THREE.PerspectiveCamera) {
    cam.position.copy(this.savedPos)
    cam.quaternion.copy(this.savedQuat)
    cam.fov = this.savedFov
    cam.updateProjectionMatrix()
  }

  // ---- Boundary visualization ----

  /** Rebuild biome boundary lines for the current segment. */
  updateBiomeBoundaries(
    segmentStartZ: number,
    segmentLength: number,
    blendLength: number,
  ) {
    if (this.biomeLines) {
      this.boundaryGroup.remove(this.biomeLines)
      this.biomeLines.geometry.dispose()
      ;(this.biomeLines.material as THREE.Material).dispose()
    }

    const pts: number[] = []
    const halfW = 30
    const y = 3

    // Segment end (green — where next biome fully starts)
    const segEnd = segmentStartZ + segmentLength
    pts.push(-halfW, y, segEnd, halfW, y, segEnd)

    // Blend start (yellow — where transition begins)
    const blendStart = segmentStartZ + segmentLength - blendLength
    pts.push(-halfW, y, blendStart, halfW, y, blendStart)

    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))

    const colors = new Float32Array(pts.length)
    colors[0] = 0; colors[1] = 1; colors[2] = 0  // green
    colors[3] = 0; colors[4] = 1; colors[5] = 0
    colors[6] = 1; colors[7] = 1; colors[8] = 0  // yellow
    colors[9] = 1; colors[10] = 1; colors[11] = 0
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

    const mat = new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 2 })
    this.biomeLines = new THREE.LineSegments(geom, mat)
    this.boundaryGroup.add(this.biomeLines)
  }

  /** Rebuild chunk boundary grid around the camera. */
  updateChunkBoundaries(cameraZ: number) {
    if (this.chunkLines) {
      this.boundaryGroup.remove(this.chunkLines)
      this.chunkLines.geometry.dispose()
      ;(this.chunkLines.material as THREE.Material).dispose()
    }

    const pts: number[] = []
    const bounds = terrainFootprint(256, cameraZ)
    const y = 1.5
    for (let z = bounds.minZ; z <= bounds.maxZ; z += CHUNK_SIZE) {
      pts.push(bounds.minX, y, z, bounds.maxX, y, z)
    }
    for (let x = bounds.minX; x <= bounds.maxX; x += CHUNK_SIZE) {
      pts.push(x, y, bounds.minZ, x, y, bounds.maxZ)
    }

    if (pts.length === 0) return

    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    const mat = new THREE.LineBasicMaterial({
      color: 0x4488ff,
      linewidth: 1,
      transparent: true,
      opacity: 0.35,
    })
    this.chunkLines = new THREE.LineSegments(geom, mat)
    this.boundaryGroup.add(this.chunkLines)
  }

  // ---- HUD update ----

  /** Call every frame to refresh HUD text (only when hudLevel >= 2). */
  updateHud(info: {
    camPos: THREE.Vector3
    camSpeed: number
    targetSpeed: number
    routeGrade: number
    routeElevation: number
    cameraPitch: number
    currentBiome: string
    nextBiome: string
    segmentStartZ: number
    segmentLength: number
    blendLength: number
    chunkCount: number
    fps: number
    frameTime: number
    drawCalls: number
    triangles: number
    topDown: boolean
    sceneHidden: boolean
    terrainDebugView: 0 | 1
    streamingFrozen: boolean
    terrain: {
      activeChunks: number
      pendingChunks: number
      createdChunks: number
      releasedChunks: number
      cityClusters: number
      lods: string
    }
  }) {
    if (this.hudLevel < 2) return

    const blendStart = info.segmentStartZ + info.segmentLength - info.blendLength
    const segEnd = info.segmentStartZ + info.segmentLength
    const distToBlend = blendStart - info.camPos.z
    const distToEnd = segEnd - info.camPos.z

    this.hudEl.textContent =
      `[DEBUG]  F2 Hard sleeper  F3 HUD  F5 ${info.topDown ? 'Cabin view' : 'Aerial view'}  F6 Exterior\n` +
      `F7 ${info.terrainDebugView ? 'Surface weights' : 'Normal'}  F8 ${info.streamingFrozen ? 'Stream frozen' : 'Streaming'}\n` +
      `F4 Station  F9 Town  F10 Lakeshore  F11 Highlands\n` +
      `\n` +
      `Camera  x:${info.camPos.x.toFixed(2)}  y:${info.camPos.y.toFixed(2)}  z:${info.camPos.z.toFixed(1)}\n` +
      `Speed   ${info.camSpeed.toFixed(1)} → ${info.targetSpeed.toFixed(1)}  u/s\n` +
      `Grade   ${(info.routeGrade * 100).toFixed(2)}%  Elevation ${info.routeElevation.toFixed(1)}  pitch ${(info.cameraPitch * 180 / Math.PI).toFixed(2)}°\n` +
      `\n` +
      `── Terrain chunks (${CHUNK_SIZE}u) ──\n` +
      `Chunk   z:${(Math.floor(info.camPos.z / CHUNK_SIZE) * CHUNK_SIZE).toFixed(0)}  (${info.chunkCount} active)\n` +
      `Stream  active ${info.terrain.activeChunks}  queue ${info.terrain.pendingChunks}  +${info.terrain.createdChunks} / -${info.terrain.releasedChunks}\n` +
      `LOD     ${info.terrain.lods}  Towns ${info.terrain.cityClusters}\n` +
      `\n` +
      `── Route segment (${info.segmentLength}u) ──\n` +
      `${info.currentBiome} → ${info.nextBiome}\n` +
      `Segment ${info.segmentStartZ.toFixed(0)} → ${segEnd.toFixed(0)}\n` +
      `Blend   ${blendStart.toFixed(0)} (${distToBlend.toFixed(0)}u ahead)\n` +
      `To end  ${distToEnd.toFixed(0)}u\n` +
      `\n` +
      `── Performance ──\n` +
      `FPS  ${info.fps}  (${info.frameTime}ms)\n` +
      `Draw  ${info.drawCalls}  Tri  ${(info.triangles / 1000).toFixed(1)}k\n` +
      `\n` +
      `Aerial ${info.topDown ? 'ON' : 'off'}  Exterior ${info.sceneHidden ? 'off' : 'ON'}  Streaming ${info.streamingFrozen ? 'frozen' : 'ON'}`
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey)
    this.hudEl.remove()
    this.carriageInspectorEl.remove()
    if (this.biomeLines) {
      this.biomeLines.geometry.dispose()
      ;(this.biomeLines.material as THREE.Material).dispose()
    }
    if (this.chunkLines) {
      this.chunkLines.geometry.dispose()
      ;(this.chunkLines.material as THREE.Material).dispose()
    }
  }
}
