import * as THREE from 'three'

const CHUNK_SIZE = 256

/**
 * Unified debug mode with HUD overlay.
 *
 * Keys:
 *   F3  — cycle HUD: off → perf only → full debug → off
 *   F5  — toggle top-down aerial view (follows train, shows boundaries)
 *   F6  — toggle scene-hidden mode (hide everything but window frame)
 */
export class DebugMode {
  // ---- HUD level ----
  // 0 = off, 1 = perf only, 2 = full debug
  hudLevel = 0

  // ---- State ----
  topDown = false
  sceneHidden = false

  // ---- HUD DOM ----
  private hudEl: HTMLDivElement

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
    window.addEventListener('keydown', this.onKey)
  }

  /** Register the scene and the exterior group that scene-hidden mode toggles. */
  init(scene: THREE.Scene, exteriorGroup: THREE.Group) {
    this.exteriorGroup = exteriorGroup
    this.boundaryGroup.visible = false
    scene.add(this.boundaryGroup)
  }

  private onKey = (e: KeyboardEvent) => {
    // Only handle if not typing in an input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

    switch (e.key) {
      case 'F3':
        e.preventDefault()
        this.cycleHud()
        break
      case 'F5':
        e.preventDefault()
        this.toggleTopDown()
        break
      case 'F6':
        e.preventDefault()
        this.toggleSceneHidden()
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
        this.boundaryGroup.visible = true
        break
    }
  }

  // ---- Toggles ----

  private toggleTopDown() {
    this.topDown = !this.topDown
  }

  private toggleSceneHidden() {
    this.sceneHidden = !this.sceneHidden
    if (this.exteriorGroup) {
      this.exteriorGroup.visible = !this.sceneHidden
    }
  }

  /** Whether the debug camera should override the normal camera. */
  get isTopDown(): boolean {
    return this.topDown
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
    cam.position.set(0, 220, cam.position.z)
    cam.lookAt(0, 0, cam.position.z + 1)
    cam.fov = 50
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
    const gridRadius = 3
    const cz = Math.floor(cameraZ / CHUNK_SIZE) * CHUNK_SIZE
    const halfW = 25
    const y = 1.5

    for (let dz = -gridRadius; dz <= gridRadius + 1; dz++) {
      const z = cz + dz * CHUNK_SIZE
      pts.push(-halfW, y, z, halfW, y, z)
    }

    const cx = Math.floor(0 / CHUNK_SIZE) * CHUNK_SIZE
    for (let dx = 0; dx <= 3; dx++) {
      const x = cx + dx * CHUNK_SIZE
      pts.push(x, y, cz - gridRadius * CHUNK_SIZE, x, y, cz + (gridRadius + 1) * CHUNK_SIZE)
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
  }) {
    if (this.hudLevel < 2) return

    const blendStart = info.segmentStartZ + info.segmentLength - info.blendLength
    const segEnd = info.segmentStartZ + info.segmentLength
    const distToBlend = blendStart - info.camPos.z
    const distToEnd = segEnd - info.camPos.z

    this.hudEl.textContent =
      `[DEBUG]  F3 HUD  F5 ${info.topDown ? '下车' : '俯瞰'}  F6 无场景\n` +
      `\n` +
      `Camera  x:${info.camPos.x.toFixed(2)}  y:${info.camPos.y.toFixed(2)}  z:${info.camPos.z.toFixed(1)}\n` +
      `速度    ${info.camSpeed.toFixed(1)} → ${info.targetSpeed.toFixed(1)}  u/s\n` +
      `\n` +
      `── 场景分块 (${CHUNK_SIZE}u) ──\n` +
      `当前块  z:${(Math.floor(info.camPos.z / CHUNK_SIZE) * CHUNK_SIZE).toFixed(0)}  (${info.chunkCount} active)\n` +
      `\n` +
      `── 生态区段 (${info.segmentLength}u) ──\n` +
      `${info.currentBiome} → ${info.nextBiome}\n` +
      `区段    ${info.segmentStartZ.toFixed(0)} → ${segEnd.toFixed(0)}\n` +
      `过渡    ${blendStart.toFixed(0)} (${distToBlend.toFixed(0)}u ahead)\n` +
      `距结束  ${distToEnd.toFixed(0)}u\n` +
      `\n` +
      `── 性能 ──\n` +
      `FPS  ${info.fps}  (${info.frameTime}ms)\n` +
      `Draw  ${info.drawCalls}  Tri  ${(info.triangles / 1000).toFixed(1)}k\n` +
      `\n` +
      `俯瞰 ${info.topDown ? 'ON' : 'off'}  无场景 ${info.sceneHidden ? 'ON' : 'off'}`
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey)
    this.hudEl.remove()
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
