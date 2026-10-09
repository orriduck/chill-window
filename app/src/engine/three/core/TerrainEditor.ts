import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { TerrainLOD } from '../terrain/TerrainLOD'
import { CHUNK_SIZE } from '../terrain/DecorationPlacement'
import { PATCH_SCENES, type PatchSettings } from '../terrain/TerrainEdits'
import { terrainFootprint, terrainTiles } from '../terrain/TerrainFootprint'

export interface PatchSelection { x: number; z: number; settings: PatchSettings; edited: boolean }

/** An independent map camera: panning never changes the train position. */
export class TerrainEditor {
  readonly camera = new THREE.PerspectiveCamera(45, 1, 1, 6000)
  readonly controls: OrbitControls
  readonly group = new THREE.Group()
  onSelection: (selection: PatchSelection | null) => void = () => {}
  private terrain: TerrainLOD
  private canvas: HTMLCanvasElement
  private labels = document.createElement('div')
  private tiles: { x: number; z: number; line: THREE.Line; label: HTMLButtonElement }[] = []
  private selected: { x: number; z: number } | null = null
  private ray = new THREE.Raycaster()
  private anchor = ''
  private lastPointer = new THREE.Vector2()
  private pointerId = -1
  private enabled = false
  private marker: THREE.Mesh

  constructor(terrain: TerrainLOD, canvas: HTMLCanvasElement, scene: THREE.Scene) {
    this.terrain = terrain
    this.canvas = canvas
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enabled = false
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.12
    this.controls.screenSpacePanning = false
    this.controls.minDistance = 180
    this.controls.maxDistance = 1900
    this.controls.minPolarAngle = 0.08
    this.controls.maxPolarAngle = Math.PI * 0.38
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }
    this.labels.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:100;display:none;overflow:hidden;'
    this.labels.setAttribute('aria-label', '车窗侧六个区块')
    document.body.append(this.labels)
    this.marker = new THREE.Mesh(new THREE.ConeGeometry(5, 15, 4), new THREE.MeshBasicMaterial({ color: 0xeac879, depthTest: false }))
    this.marker.rotation.z = Math.PI
    this.marker.renderOrder = 120
    this.group.add(this.marker)
    this.group.visible = false
    scene.add(this.group)
    canvas.addEventListener('pointerdown', this.onDown)
    canvas.addEventListener('pointerup', this.onUp)
  }
  resize(width: number, height: number) { this.camera.aspect = width / Math.max(1, height); this.camera.updateProjectionMatrix() }
  recenter(trainZ: number) {
    // Flush pan/rotation inertia before assigning the new camera pose.
    const damping = this.controls.enableDamping
    this.controls.enableDamping = false
    this.controls.update()
    const z = Math.floor(trainZ / CHUNK_SIZE) * CHUNK_SIZE + 128
    this.controls.target.set(256, 0, z)
    this.camera.position.set(256 + 420, 740, z + 580)
    this.controls.update()
    this.controls.enableDamping = damping
    this.anchor = ''
  }
  setEnabled(value: boolean, trainZ: number) {
    if (value === this.enabled) return
    this.enabled = value
    this.controls.enabled = value
    this.group.visible = value
    this.labels.style.display = value ? 'block' : 'none'
    if (value) this.recenter(trainZ)
    if (!value) this.terrain.setEditorFocus(null)
  }
  get isEnabled() { return this.enabled }
  get focus() { return this.controls.target }
  select(x: number, z: number) {
    this.selected = { x, z }
    this.onSelection({ x, z, settings: this.terrain.edits.settings(x, z), edited: this.terrain.edits.has(x, z) })
    this.refreshGrid()
  }
  clearSelection() { this.selected = null; this.onSelection(null); this.refreshGrid() }
  regenerate(settings: PatchSettings | null) {
    if (!this.selected) return
    const { x, z } = this.selected
    this.terrain.regeneratePatch(x, z, settings)
    this.select(x, z)
  }
  private onDown = (event: PointerEvent) => {
    if (!this.enabled || event.button !== 0) return
    this.lastPointer.set(event.clientX, event.clientY)
    this.pointerId = event.pointerId
  }
  private onUp = (event: PointerEvent) => {
    if (!this.enabled || event.button !== 0 || event.pointerId !== this.pointerId) return
    this.pointerId = -1
    if (this.lastPointer.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5) return
    const rect = this.canvas.getBoundingClientRect()
    this.ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), this.camera)
    const chunks = this.terrain.editableChunks()
    const hit = this.ray.intersectObjects(chunks.map(chunk => chunk.mesh))[0]
    if (!hit) return
    const chunk = chunks.find(chunk => chunk.mesh === hit.object)
    if (chunk) this.select(chunk.x, chunk.z)
  }
  private refreshGrid() {
    for (const tile of this.tiles) { this.group.remove(tile.line); tile.line.geometry.dispose(); (tile.line.material as THREE.Material).dispose(); tile.label.remove() }
    this.tiles = []
    for (const { x, z } of terrainTiles(this.focus.x, this.focus.z, true)) {
      const selected = this.selected?.x === x && this.selected?.z === z
      const points: THREE.Vector3[] = []
      for (let edge = 0; edge < 4; edge++) for (let i = 0; i <= 16; i++) {
        const t = i / 16 * CHUNK_SIZE
        const wx = x * CHUNK_SIZE + (edge === 0 ? t : edge === 1 ? CHUNK_SIZE : edge === 2 ? CHUNK_SIZE - t : 0)
        const wz = z * CHUNK_SIZE + (edge === 0 ? 0 : edge === 1 ? t : edge === 2 ? CHUNK_SIZE : CHUNK_SIZE - t)
        points.push(new THREE.Vector3(wx, this.terrain.sampleHeight(wx, wz) + 0.6, wz))
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: selected ? 0xf1c769 : 0xe5e9d2, transparent: true, opacity: selected ? 1 : 0.62, depthTest: false }))
      line.renderOrder = 100
      this.group.add(line)
      const label = document.createElement('button')
      label.type = 'button'
      label.textContent = `${x}, ${z}`
      label.setAttribute('aria-label', `选择区块 ${x},${z}`)
      label.title = PATCH_SCENES[this.terrain.edits.settings(x, z).scene].label
      label.style.cssText = `position:absolute;transform:translate(-50%,-50%);border:1px solid ${selected ? '#e0b557' : '#ffffff48'};border-radius:5px;background:${selected ? '#e5c774' : '#263b2be6'};color:${selected ? '#26372b' : '#f4f0e4'};font:11px system-ui;padding:5px 8px;cursor:pointer;pointer-events:auto;box-shadow:0 2px 12px #0003;`
      label.onclick = () => this.select(x, z)
      this.labels.append(label)
      this.tiles.push({ x, z, line, label })
    }
  }
  update(trainZ: number) {
    if (!this.enabled) return
    this.controls.update()
    if (this.controls.target.x < 256) {
      this.camera.position.x += 256 - this.controls.target.x
      this.controls.target.x = 256
    }
    this.controls.target.y = 0
    const bounds = terrainFootprint(this.focus.x, this.focus.z, true)
    const key = `${bounds.x},${bounds.z}`
    if (key !== this.anchor) {
      this.anchor = key
      if (this.selected && (this.selected.x < bounds.x || this.selected.x > bounds.x + 1 || Math.abs(this.selected.z - bounds.z) > 1)) { this.selected = null; this.onSelection(null) }
      this.refreshGrid()
    }
    this.terrain.setEditorFocus(this.focus)
    this.camera.updateMatrixWorld()
    const rect = this.canvas.getBoundingClientRect()
    for (const tile of this.tiles) {
      const point = new THREE.Vector3((tile.x + 0.5) * CHUNK_SIZE, this.terrain.sampleHeight((tile.x + 0.5) * CHUNK_SIZE, (tile.z + 0.5) * CHUNK_SIZE) + 4, (tile.z + 0.5) * CHUNK_SIZE).project(this.camera)
      tile.label.style.left = `${rect.left + (point.x + 1) / 2 * rect.width}px`
      tile.label.style.top = `${rect.top + (1 - point.y) / 2 * rect.height}px`
      tile.label.style.display = point.z > 1 || point.z < -1 ? 'none' : 'block'
    }
    this.marker.position.set(0, this.terrain.sampleHeight(0, trainZ) + 24, trainZ)
    this.marker.visible = bounds.x === 0 && trainZ >= bounds.minZ && trainZ <= bounds.maxZ
  }
  dispose() {
    this.controls.dispose()
    this.canvas.removeEventListener('pointerdown', this.onDown)
    this.canvas.removeEventListener('pointerup', this.onUp)
    this.labels.remove()
    this.group.traverse(object => { if (object instanceof THREE.Mesh || object instanceof THREE.Line) { object.geometry.dispose(); (object.material as THREE.Material).dispose() } })
    this.group.removeFromParent()
  }
}
