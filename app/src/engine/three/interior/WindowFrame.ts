import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { buildSoftSeatCoach, buildSeatLuggageRacks } from './SoftSeatCoach'
import { PASSENGER_VIEWS, type PassengerView } from '../core/PassengerView'

const OPENING_W = 4.0
const OPENING_H = 2.3
const FRAME_T = 0.14
const CABIN_FLOOR_Y = -2.03
const WINDOW_CENTER_Y = 0.3
const WINDOW_BOTTOM_Y = WINDOW_CENTER_Y - OPENING_H / 2
const COACH_CEILING_Y = 2.12
const COACH_WINDOW_CENTERS = [-5.3, 0, 5.3] as const
const COACH_END_DOOR_X = COACH_WINDOW_CENTERS[COACH_WINDOW_CENTERS.length - 1] + OPENING_W / 2 + 0.34

// The physical cabin wall extends past the widened view volume, so the exterior
// can only be visible through the glazed opening at every supported aspect.
const WALL_W = 24
const WALL_H = 10
const RAIN_DROP_COUNT = 96
const RAIN_GLASS_TOP = OPENING_H / 2 - 0.05
const WINDOW_BAY = {
  // Keep the inner edge clear of the table and journey HUD while making the
  // usable part of each opposing seat substantially deeper.
  seatCenterX: 2.245,
  seatCenterZ: 1.38,
  seatWidth: 1.23,
  cushionWidth: 0.99,
  seatLength: 1.72,
  tableY: -0.92,
  tableWidth: 1.55,
  tableDepth: 0.86,
  tableHeight: 0.075,
} as const

export interface WindowHudReadout {
  visible: boolean
  time: string
  journey: string
  progress: number
  segmentLabel: string
  routeLabel: string
  motionLabel: string
  grade: number
  stationNames: string[]
  currentSegment: number
  paused: boolean
  soundEnabled: boolean
  fullscreen: boolean
}

export interface WindowHudControlAnchor {
  x: number
  y: number
  angle: number
}

export interface WindowHudControlHitArea {
  x: number
  y: number
  width: number
  height: number
}

export type WindowHudSurfaceLayout = {
  rail: { x: number; y: number; z: number; width: number; height: number }
}

export type WindowHudControlLayout = {
  rightInset: number
  topInset: number
  size: number
  gap: number
}

export type WindowFrameViewportLayout = {
  frameDistance: number
  scale: number
  yOffset: number
  forwardOffset: number
}

export type WindowBayLayout = {
  seatCenterX: number
  seatCenterZ: number
  seatWidth: number
  cushionWidth: number
  seatLength: number
  tableY: number
  tableWidth: number
  tableDepth: number
  tableHeight: number
}

export type CoachCabinLayout = {
  windowCenters: number[]
  ceilingY: number
  floorY: number
  windowBottomY: number
  seatBackrestTop: number
  endDoorX: number
}

export type CarriageDebugPart = 'shell' | 'seats' | 'fixtures' | 'glass' | 'lighting' | 'hud'

/** The coach bay is deliberately authored around the glazed view: seats enter
 * from the edges while the compact table stays below the physical journey rail. */
export function windowBayLayout(): WindowBayLayout {
  return { ...WINDOW_BAY }
}

/** The passenger sits at the centre bay. The two neighbouring apertures turn
 * a fixed side-window view into a coach section when the user looks along it. */
export function coachCabinLayout(): CoachCabinLayout {
  return {
    windowCenters: [...COACH_WINDOW_CENTERS],
    ceilingY: COACH_CEILING_Y,
    floorY: CABIN_FLOOR_Y,
    windowBottomY: WINDOW_BOTTOM_Y,
    seatBackrestTop: 0.81,
    endDoorX: COACH_END_DOOR_X,
  }
}

/** Keep the seat eye fixed across viewports. Narrow screens crop the same
 * window rather than pulling the passenger back into the aisle. */
export function windowFrameViewportLayout(_aspect: number, view: PassengerView = 'window'): WindowFrameViewportLayout {
  const pose = PASSENGER_VIEWS[view]
  return { frameDistance: pose.wallDistance, scale: 1, yOffset: pose.wallYOffset, forwardOffset: pose.windowOffset }
}

/** The passive journey rail occupies one real cabin/window plane. Its
 * perspective comes from the same camera projection as the frame, not from a
 * CSS approximation. Keeping it low leaves the upper aperture for scenery. */
export function windowHudSurfaceLayout(): WindowHudSurfaceLayout {
  return {
    rail: { x: -0.02, y: WINDOW_BOTTOM_Y + 0.22, z: 0.035, width: 2.3, height: 0.4 },
  }
}

/** Canvas-space layout for the five controls painted into the physical rail.
 * The interactive DOM hit strip uses the same right/top corner projection. */
export function windowHudControlLayout(): WindowHudControlLayout {
  return { rightInset: 64, topInset: 14, size: 42, gap: 7 }
}

/** Source geometry shared by canvas drawing and projected pointer hit areas. */
export function windowHudControlCanvasRects() {
  const layout = windowHudControlLayout()
  const canvasWidth = 1280
  const stripWidth = layout.size * 5 + layout.gap * 4
  const startX = canvasWidth - layout.rightInset - stripWidth
  return Array.from({ length: 5 }, (_, index) => ({
    x: startX + index * (layout.size + layout.gap),
    y: layout.topInset,
    width: layout.size,
    height: layout.size,
  }))
}

/** Keep the physical progress stripe within its drawn surface. */
export function clampWindowHudProgress(progress: number): number {
  return THREE.MathUtils.clamp(progress, 0, 1)
}

/** A stopped train leaves water to creep; speed creates a shorter, faster streak. */
export function rainDropFallSpeed(speedRatio: number): number {
  return 0.14 + THREE.MathUtils.clamp(speedRatio, 0, 1) * 0.75
}

/** Deterministic helper for tests: droplets may never spawn above the glass. */
export function rainDropInitialY(randomValue: number): number {
  return (THREE.MathUtils.clamp(randomValue, 0, 1) * 2 - 1) * RAIN_GLASS_TOP
}

/** Interior reflections stay restrained in daylight and become readable only
 * as the exterior gets darker. The input is the actual ambient-light level,
 * so tunnel enclosure follows the same physical cue without a second mode. */
export function glassReflectionOpacity(ambientIntensity: number): number {
  const daylight = THREE.MathUtils.clamp(ambientIntensity / 0.45, 0, 1)
  return 0.028 + (1 - daylight) * 0.11
}

/**
 * Chinese seated coach: paired upholstered seats surround a clear side window,
 * with a shared table, luggage shelf and restrained reading lights. The perspective follows
 * the exterior world axes.
 */
export class WindowFrame {
  readonly group = new THREE.Group()
  private passengerView: PassengerView = 'window'
  private readonly debugPartGroups: Record<CarriageDebugPart, THREE.Group> = {
    shell: new THREE.Group(),
    seats: new THREE.Group(),
    fixtures: new THREE.Group(),
    glass: new THREE.Group(),
    lighting: new THREE.Group(),
    hud: new THREE.Group(),
  }
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = []
  private wobblers: { obj: THREE.Object3D; baseY: number; phase: number }[] = []
  private rainDrops: THREE.Points | null = null
  private rainDropPositions: Float32Array | null = null
  private rainDropGeometry: THREE.BufferGeometry | null = null
  private rainDropMaterial: THREE.PointsMaterial | null = null
  private glassReflectionMaterials: { material: THREE.MeshBasicMaterial; weight: number }[] = []
  private rainOpacity = 0
  private lastUpdateTime = 0
  private windowHud: WindowHudReadout = {
    visible: false,
    time: '',
    journey: '',
    progress: 0,
    segmentLabel: '',
    routeLabel: '',
    motionLabel: '',
    grade: 0,
    stationNames: [],
    currentSegment: 0,
    paused: false,
    soundEnabled: true,
    fullscreen: false,
  }
  private journeyHudCanvas: HTMLCanvasElement | null = null
  private journeyHudTexture: THREE.CanvasTexture | null = null
  private journeyHudPlane: THREE.Mesh | null = null

  constructor() {
    for (const [part, group] of Object.entries(this.debugPartGroups)) {
      group.name = `carriage-${part}`
    }
    const frame = this.track(
      new THREE.MeshStandardMaterial({ color: 0x535550, roughness: 0.68, metalness: 0.18 })
    )
    const aluminium = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xb8b7ad,
        map: this.makeBrushedAluminiumTexture(),
        roughness: 0.3,
        metalness: 0.85,
      })
    )
    const accent = this.track(
      new THREE.MeshStandardMaterial({ color: 0x436363, roughness: 0.68, metalness: 0.08 })
    )
    const wallMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xf1ead8,
        map: this.makeCabinPanelTexture(),
        roughness: 0.86,
        metalness: 0.02,
      })
    )
    const blindMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x738480, roughness: 0.92, metalness: 0.01 })
    )

    const halfW = OPENING_W / 2 + FRAME_T / 2
    this.buildInto(this.debugPartGroups.shell, () => {
      this.buildWall(wallMat)
      this.buildCabinCeiling(aluminium, accent)
      for (const centerX of COACH_WINDOW_CENTERS) {
        this.buildFrame(frame, aluminium, halfW, centerX)
        this.buildWindowHeader(frame, blindMat, accent, centerX)
      }
      this.buildCabinFloor()
      this.buildCoachEndVestibule(aluminium, accent)
    })
    this.buildInto(this.debugPartGroups.glass, () => this.buildGlass())
    this.buildInto(this.debugPartGroups.hud, () => this.buildWindowHud())
    this.buildInto(this.debugPartGroups.seats, () => this.group.add(buildSoftSeatCoach(resource => this.track(resource), COACH_WINDOW_CENTERS, OPENING_W, OPENING_H)))
    this.buildInto(this.debugPartGroups.fixtures, () => {
      this.group.add(buildSeatLuggageRacks(resource => this.track(resource), COACH_WINDOW_CENTERS, WINDOW_CENTER_Y + OPENING_H / 2))
      this.buildWindowSconces(aluminium)
      this.buildCabinFittings(aluminium, accent)
    })
    this.buildInto(this.debugPartGroups.lighting, () => this.buildCabinLighting())
    this.promoteToForeground()
  }

  setPassengerView(view: PassengerView) {
    this.passengerView = view
  }

  setDebugPartVisible(part: CarriageDebugPart, visible: boolean) {
    this.debugPartGroups[part].visible = visible
  }

  private buildInto(target: THREE.Group, build: () => void) {
    const existing = new Set(this.group.children)
    build()
    for (const child of [...this.group.children]) {
      if (!existing.has(child) && child !== target) target.add(child)
    }
    if (target.parent !== this.group) this.group.add(target)
  }

  setHudReadout(readout: WindowHudReadout) {
    this.windowHud = {
      ...readout,
      progress: clampWindowHudProgress(readout.progress),
      currentSegment: Math.max(0, Math.floor(readout.currentSegment)),
    }
    if (this.journeyHudPlane) this.journeyHudPlane.visible = readout.visible
    if (!readout.visible) return
    this.drawWindowHud()
  }

  /** Project the painted control strip's top-right corner. The visible controls
   * live in the CanvasTexture; the DOM layer is only the click hit target. */
  getHudControlAnchor(camera: THREE.Camera): WindowHudControlAnchor | null {
    if (!this.journeyHudPlane?.visible) return null
    const layout = windowHudSurfaceLayout().rail
    const controls = windowHudControlLayout()
    const canvasWidth = 1280
    const canvasHeight = 190
    const stripWidth = controls.size * 5 + controls.gap * 4
    const rightInset = controls.rightInset
    const leftInset = rightInset + stripWidth
    const topInset = controls.topInset
    const rightTop = new THREE.Vector3(
      layout.x + layout.width / 2 - (rightInset / canvasWidth) * layout.width,
      layout.y + layout.height / 2 - (topInset / canvasHeight) * layout.height,
      layout.z + 0.01,
    )
    const leftTop = new THREE.Vector3(
      layout.x + layout.width / 2 - (leftInset / canvasWidth) * layout.width,
      layout.y + layout.height / 2 - (topInset / canvasHeight) * layout.height,
      layout.z + 0.01,
    )
    this.group.localToWorld(rightTop)
    this.group.localToWorld(leftTop)
    rightTop.project(camera)
    leftTop.project(camera)
    if (rightTop.z < -1 || rightTop.z > 1) return null
    const x = (rightTop.x + 1) / 2
    const y = (1 - rightTop.y) / 2
    const angle = Math.atan2(-(rightTop.y - leftTop.y), rightTop.x - leftTop.x)
    return { x, y, angle }
  }

  /** Individually project the transparent DOM hit areas. The visible buttons
   * remain painted into the same physical WebGL HUD texture. */
  getHudControlHitAreas(camera: THREE.Camera): WindowHudControlHitArea[] {
    if (!this.journeyHudPlane?.visible) return []
    const rail = windowHudSurfaceLayout().rail
    const canvasWidth = 1280
    const canvasHeight = 190
    const controls = windowHudControlCanvasRects()
    const project = (canvasX: number, canvasY: number) => {
      const point = new THREE.Vector3(
        rail.x - rail.width / 2 + (canvasX / canvasWidth) * rail.width,
        rail.y + rail.height / 2 - (canvasY / canvasHeight) * rail.height,
        rail.z + 0.01,
      )
      this.group.localToWorld(point)
      point.project(camera)
      return { x: (point.x + 1) / 2, y: (1 - point.y) / 2 }
    }
    return controls.map((control) => {
      const topLeft = project(control.x, control.y)
      const bottomRight = project(control.x + control.width, control.y + control.height)
      const left = Math.min(topLeft.x, bottomRight.x)
      const right = Math.max(topLeft.x, bottomRight.x)
      const top = Math.min(topLeft.y, bottomRight.y)
      const bottom = Math.max(topLeft.y, bottomRight.y)
      return { x: (left + right) / 2, y: (top + bottom) / 2, width: right - left, height: bottom - top }
    })
  }

  /** Interior uses its own post-exterior render pass, so normal depth testing
   * can be retained for correct ordering among seats, fittings and glass. */
  private promoteToForeground() {
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) {
        material.depthTest = true
        material.depthWrite = !material.transparent
      }
    })
  }

  // ---- Structure ----

  /** Cabin wall panels surrounding three connected bays. The centre aperture
   * is the passenger's window; the adjacent bays become visible on a head turn. */
  private buildWall(mat: THREE.Material) {
    const z = -0.06

    // One continuous wall keeps the pillars and panel joints physically
    // consistent rather than reading as a floating, single-window set.
    const wall = new THREE.Shape()
    wall.moveTo(-WALL_W / 2, -WALL_H / 2)
    wall.lineTo(WALL_W / 2, -WALL_H / 2)
    wall.lineTo(WALL_W / 2, WALL_H / 2)
    wall.lineTo(-WALL_W / 2, WALL_H / 2)
    wall.closePath()
    const radius = 0.26
    for (const centerX of COACH_WINDOW_CENTERS) {
      const hole = new THREE.Path()
      hole.moveTo(centerX - OPENING_W / 2 + radius, WINDOW_CENTER_Y - OPENING_H / 2)
      hole.lineTo(centerX + OPENING_W / 2 - radius, WINDOW_CENTER_Y - OPENING_H / 2)
      hole.absarc(centerX + OPENING_W / 2 - radius, WINDOW_CENTER_Y - OPENING_H / 2 + radius, radius, -Math.PI / 2, 0, false)
      hole.lineTo(centerX + OPENING_W / 2, WINDOW_CENTER_Y + OPENING_H / 2 - radius)
      hole.absarc(centerX + OPENING_W / 2 - radius, WINDOW_CENTER_Y + OPENING_H / 2 - radius, radius, 0, Math.PI / 2, false)
      hole.lineTo(centerX - OPENING_W / 2 + radius, WINDOW_CENTER_Y + OPENING_H / 2)
      hole.absarc(centerX - OPENING_W / 2 + radius, WINDOW_CENTER_Y + OPENING_H / 2 - radius, radius, Math.PI / 2, Math.PI, false)
      hole.lineTo(centerX - OPENING_W / 2, WINDOW_CENTER_Y - OPENING_H / 2 + radius)
      hole.absarc(centerX - OPENING_W / 2 + radius, WINDOW_CENTER_Y - OPENING_H / 2 + radius, radius, Math.PI, Math.PI * 1.5, false)
      hole.closePath()
      wall.holes.push(hole)
    }
    const wallMesh = new THREE.Mesh(this.track(new THREE.ShapeGeometry(wall)), mat)
    wallMesh.position.z = z
    this.group.add(wallMesh)

    // Ceiling join and cove lighting frame the bay without introducing a
    // period-carriage luggage rack or loose decorative props.
    const trimMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x9daab0, roughness: 0.62, metalness: 0.28 })
    )
    const trim = new THREE.Mesh(this.box(WALL_W, 0.1, 0.06), trimMat)
    trim.position.set(0, COACH_CEILING_Y - 0.08, z + 0.01)
    this.group.add(trim)

    const coveMat = this.track(
      new THREE.MeshBasicMaterial({ color: 0xe8ebdf, transparent: true, opacity: 0.48 })
    )
    const cove = new THREE.Mesh(this.track(new THREE.PlaneGeometry(WALL_W * 0.92, 0.06)), coveMat)
    cove.position.set(0, COACH_CEILING_Y - 0.18, z + 0.04)
    this.group.add(cove)
  }

  /** Pale moulded ceiling panels and long fluorescent housings match the
   * practical, evenly lit character of a conventional long-distance coach. */
  private buildCabinCeiling(aluminium: THREE.Material, accent: THREE.Material) {
    const ceilingMat = this.track(
      new THREE.MeshStandardMaterial({
        map: this.makeCabinPanelTexture(),
        color: 0xeee8d9,
        roughness: 0.82,
        metalness: 0.08,
      }),
    )
    const ceiling = new THREE.Mesh(this.track(new THREE.PlaneGeometry(WALL_W, 5.8)), ceilingMat)
    ceiling.rotation.x = Math.PI / 2
    ceiling.position.set(0, COACH_CEILING_Y, 2.72)
    this.group.add(ceiling)

    const seamMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xb8b5a9, roughness: 0.58, metalness: 0.28 }),
    )
    for (const z of [0.08, 1.46, 2.84, 4.22]) {
      const seam = new THREE.Mesh(this.box(WALL_W - 0.35, 0.028, 0.045), seamMat)
      seam.position.set(0, COACH_CEILING_Y - 0.018, z)
      this.group.add(seam)
    }

    const lightHousing = this.track(
      new THREE.MeshStandardMaterial({ color: 0xbebcaf, roughness: 0.58, metalness: 0.24 }),
    )
    const lightLens = this.track(
      new THREE.MeshBasicMaterial({ color: 0xfff2d7, transparent: true, opacity: 0.92 }),
    )
    for (const x of COACH_WINDOW_CENTERS) {
      const housing = new THREE.Mesh(this.box(2.5, 0.055, 0.2), lightHousing)
      housing.position.set(x, COACH_CEILING_Y - 0.045, 1.1)
      this.group.add(housing)
      const lens = new THREE.Mesh(this.box(2.24, 0.014, 0.075), lightLens)
      lens.position.set(x, COACH_CEILING_Y - 0.078, 1.1)
      this.group.add(lens)
      const ceilingLight = new THREE.PointLight(0xffe7c5, 0.34, 3.4, 2)
      ceilingLight.position.set(x, COACH_CEILING_Y - 0.22, 0.92)
      this.group.add(ceilingLight)
    }

    const coveRail = new THREE.Mesh(this.box(WALL_W - 0.5, 0.035, 0.055), aluminium)
    coveRail.position.set(0, COACH_CEILING_Y - 0.11, 0.04)
    this.group.add(coveRail)
    const coveAccent = new THREE.Mesh(this.box(WALL_W - 0.9, 0.015, 0.018), accent)
    coveAccent.position.set(0, COACH_CEILING_Y - 0.14, 0.085)
    this.group.add(coveAccent)
  }

  private buildFrame(frame: THREE.Material, metal: THREE.Material, halfW: number, centerX: number) {
    const roundedPath = (inset: number) => {
      const radius = 0.26 - inset * 0.35
      const width = OPENING_W - inset * 2
      const height = OPENING_H - inset * 2
      const right = centerX + width / 2
      const left = centerX - width / 2
      const top = WINDOW_CENTER_Y + height / 2
      const bottom = WINDOW_CENTER_Y - height / 2
      const z = 0.05
      const path = new THREE.CurvePath<THREE.Vector3>()
      const point = (x: number, y: number) => new THREE.Vector3(x, y, z)
      const topLeft = point(left + radius, top)
      const topRight = point(right - radius, top)
      const rightTop = point(right, top - radius)
      const rightBottom = point(right, bottom + radius)
      const bottomRight = point(right - radius, bottom)
      const bottomLeft = point(left + radius, bottom)
      const leftBottom = point(left, bottom + radius)
      const leftTop = point(left, top - radius)

      path.add(new THREE.LineCurve3(topLeft, topRight))
      path.add(new THREE.QuadraticBezierCurve3(topRight, point(right, top), rightTop))
      path.add(new THREE.LineCurve3(rightTop, rightBottom))
      path.add(new THREE.QuadraticBezierCurve3(rightBottom, point(right, bottom), bottomRight))
      path.add(new THREE.LineCurve3(bottomRight, bottomLeft))
      path.add(new THREE.QuadraticBezierCurve3(bottomLeft, point(left, bottom), leftBottom))
      path.add(new THREE.LineCurve3(leftBottom, leftTop))
      path.add(new THREE.QuadraticBezierCurve3(leftTop, point(left, top), topLeft))
      return path
    }

    const outerCurve = roundedPath(0)
    const outerFrame = new THREE.Mesh(this.track(new THREE.TubeGeometry(outerCurve, 96, FRAME_T * 0.86, 8, true)), frame)
    this.group.add(outerFrame)
    const innerCurve = roundedPath(0.11)
    const innerTrim = new THREE.Mesh(this.track(new THREE.TubeGeometry(innerCurve, 96, 0.022, 6, true)), metal)
    this.group.add(innerTrim)

    const sill = new THREE.Mesh(this.box(OPENING_W - 0.18, 0.1, 0.3), frame)
    sill.position.set(centerX, WINDOW_BOTTOM_Y + 0.02, 0.17)
    this.group.add(sill)
    const latch = new THREE.Mesh(this.box(0.12, 0.04, 0.06), metal)
    latch.position.set(centerX + halfW - 0.34, WINDOW_BOTTOM_Y + 0.12, 0.11)
    this.group.add(latch)
  }

  /** A simple curtain rail and top valance sit above the seated-coach window. */
  private buildWindowHeader(frame: THREE.Material, blindMat: THREE.Material, accent: THREE.Material, centerX: number) {
    const cassette = new THREE.Mesh(this.box(OPENING_W - 0.24, 0.16, 0.13), blindMat)
    cassette.position.set(centerX, WINDOW_CENTER_Y + OPENING_H / 2 - 0.02, 0.09)
    this.group.add(cassette)
    const lowerEdge = new THREE.Mesh(this.box(OPENING_W - 0.46, 0.018, 0.02), accent)
    lowerEdge.position.set(centerX, WINDOW_CENTER_Y + OPENING_H / 2 - 0.115, 0.17)
    this.group.add(lowerEdge)
    for (const side of [-1, 1]) {
      const fixing = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.028, 0.028, 0.025, 10)), frame)
      fixing.rotation.x = Math.PI / 2
      fixing.position.set(centerX + side * (OPENING_W / 2 - 0.28), WINDOW_CENTER_Y + OPENING_H / 2 + 0.08, 0.12)
      this.group.add(fixing)
    }
  }

  // ---- Coach fittings ----

  /** Aluminium luggage rail with a compact soft case. */
  buildLuggageRack(aluminium: THREE.Material) {
    const rackY = OPENING_H / 2 + 0.15
    const rackZ = 0.3

    const shelfMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xc5cdd0, roughness: 0.5, metalness: 0.4 })
    )
    const shelf = new THREE.Mesh(this.box(3.4, 0.04, 0.5), shelfMat)
    shelf.position.set(0.2, rackY, rackZ)
    this.group.add(shelf)

    const railGeom = this.track(new THREE.CylinderGeometry(0.015, 0.015, 3.4, 8))
    railGeom.rotateZ(Math.PI / 2)
    for (const dy of [0.1, 0.22]) {
      const rail = new THREE.Mesh(railGeom, aluminium)
      rail.position.set(0.2, rackY + dy, rackZ + 0.24)
      this.group.add(rail)
    }
    for (const px of [-1.3, 0.2, 1.7]) {
      const post = new THREE.Mesh(this.box(0.02, 0.24, 0.02), aluminium)
      post.position.set(px, rackY + 0.12, rackZ + 0.24)
      this.group.add(post)
    }

    const bagMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x4c6677, roughness: 0.88, metalness: 0.02 })
    )
    const bag = new THREE.Group()
    bag.add(new THREE.Mesh(this.box(0.7, 0.32, 0.27), bagMat))
    const zipperMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xdee6e8, roughness: 0.32, metalness: 0.72 })
    )
    const zipper = new THREE.Mesh(this.box(0.62, 0.018, 0.025), zipperMat)
    zipper.position.set(0, 0.12, 0.14)
    bag.add(zipper)
    bag.position.set(-0.75, rackY + 0.19, rackZ)
    bag.rotation.y = 0.08
    this.group.add(bag)
    this.wobblers.push({ obj: bag, baseY: bag.position.y, phase: 2.6 })
  }

  /** Reading lamps and switches sit on the window pillars. */
  private buildWindowSconces(aluminium: THREE.Material) {
    const housingMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xe1dccd, roughness: 0.7, metalness: 0.12 })
    )
    const glowMat = this.track(
      new THREE.MeshBasicMaterial({ color: 0xffe5bd, transparent: true, opacity: 0.9 })
    )
    for (const side of [-1, 1]) {
      const pod = new THREE.Group()
      const mount = new THREE.Mesh(this.box(0.29, 0.45, 0.045), housingMat)
      pod.add(mount)
      const housing = new THREE.Mesh(this.box(0.29, 0.15, 0.12), housingMat)
      housing.position.set(0, 0.12, 0.07)
      pod.add(housing)
      const lens = new THREE.Mesh(this.box(0.16, 0.035, 0.02), glowMat)
      lens.position.set(0, 0.09, 0.135)
      pod.add(lens)
      const switchPlate = new THREE.Mesh(this.box(0.12, 0.14, 0.024), aluminium)
      switchPlate.position.set(0, -0.11, 0.03)
      pod.add(switchPlate)
      const switchDot = new THREE.Mesh(this.track(new THREE.CircleGeometry(0.018, 10)), glowMat)
      switchDot.position.set(0, -0.11, 0.046)
      pod.add(switchDot)
      pod.position.set(side * (OPENING_W / 2 + 0.36), WINDOW_CENTER_Y + 0.48, 0.07)
      this.group.add(pod)
    }
  }

  /** A continuous resilient floor gives the compartment depth under the
   * furniture and turns the coach from a wall-mounted display into a room. */
  private buildCabinFloor() {
    const floorMat = this.track(
      new THREE.MeshStandardMaterial({
        map: this.makeCabinFloorTexture(),
        color: 0x647d80,
        emissive: 0x17262a,
        emissiveIntensity: 0.42,
        roughness: 0.92,
        metalness: 0.04,
      }),
    )
    const floor = new THREE.Mesh(this.track(new THREE.PlaneGeometry(WALL_W - 1.2, 6.4)), floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(0, CABIN_FLOOR_Y, 1.32)
    this.group.add(floor)

    const runnerMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x1e2c31, roughness: 0.96, metalness: 0 }),
    )
    const runner = new THREE.Mesh(this.box(1.35, 0.025, 4.6), runnerMat)
    runner.position.set(0, CABIN_FLOOR_Y + 0.025, 1.35)
    this.group.add(runner)

    const thresholdMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x91a6aa, roughness: 0.38, metalness: 0.64 }),
    )
    for (const z of [-0.72, 0.72, 2.16]) {
      const threshold = new THREE.Mesh(this.box(WALL_W - 1.45, 0.025, 0.035), thresholdMat)
      threshold.position.set(0, CABIN_FLOOR_Y + 0.035, z)
      this.group.add(threshold)
    }
  }

  /** Window heaters, vents, sockets and seat-side fittings establish the
   * practical mechanical layer visible in ordinary seated-coach coaches. */
  private buildCabinFittings(aluminium: THREE.Material, accent: THREE.Material) {
    const lowerMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xc9c5b6, roughness: 0.78, metalness: 0.1 })
    )
    const lowerWall = new THREE.Mesh(this.box(WALL_W - 0.5, 0.3, 0.18), lowerMat)
    lowerWall.position.set(0, WINDOW_BOTTOM_Y - 0.38, -0.02)
    this.group.add(lowerWall)
    for (const centerX of COACH_WINDOW_CENTERS) {
      const vent = new THREE.Mesh(this.box(OPENING_W - 0.42, 0.28, 0.14), lowerMat)
      vent.position.set(centerX, WINDOW_BOTTOM_Y - 0.42, 0.11)
      this.group.add(vent)
      for (let x = -1.2; x <= 1.2; x += 0.16) {
        const slot = new THREE.Mesh(this.box(0.055, 0.12, 0.018), aluminium)
        slot.position.set(centerX + x, WINDOW_BOTTOM_Y - 0.42, 0.19)
        this.group.add(slot)
      }
      const socketPanel = new THREE.Mesh(this.roundedBox(0.38, 0.18, 0.04, 0.025), lowerMat)
      socketPanel.position.set(centerX + 0.72, WINDOW_BOTTOM_Y - 0.18, 0.18)
      this.group.add(socketPanel)
      const port = new THREE.Mesh(this.box(0.09, 0.045, 0.012), accent)
      port.position.set(centerX + 0.72, WINDOW_BOTTOM_Y - 0.18, 0.205)
      this.group.add(port)
    }
  }

  /** Close the final bay with a real vestibule bulkhead rather than ending the
   * seating row in open darkness. The glazed door signals a connected coach
   * while retaining a shallow, affordable interior volume. */
  private buildCoachEndVestibule(aluminium: THREE.Material, accent: THREE.Material) {
    const wallMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xd8d2c2, roughness: 0.82, metalness: 0.06 }),
    )
    const doorMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xb8b4a8, roughness: 0.64, metalness: 0.2 }),
    )
    const glassMat = this.track(
      new THREE.MeshBasicMaterial({
        color: 0xa9cdd5,
        transparent: true,
        opacity: 0.68,
      }),
    )
    // The bulkhead ends at the window wall: extending it through local Z < 0
    // puts cabin geometry outside the train, visible from a close window seat.
    const endWall = new THREE.Mesh(this.box(0.14, 4.02, 4.6), wallMat)
    endWall.position.set(COACH_END_DOOR_X, -0.01, 2.23)
    this.group.add(endWall)

    const door = new THREE.Group()
    const slab = new THREE.Mesh(this.box(0.08, 3.55, 1.54), doorMat)
    slab.position.set(0, -0.24, 0)
    door.add(slab)
    for (const side of [-1, 1]) {
      const pane = new THREE.Mesh(this.box(0.018, 1.05, 0.88), glassMat)
      pane.position.set(side * 0.055, 0.91, 0)
      door.add(pane)
    }
    const lowerKick = new THREE.Mesh(this.box(0.025, 0.52, 1.28), aluminium)
    lowerKick.position.set(-0.06, -1.48, 0)
    door.add(lowerKick)
    const handle = new THREE.Mesh(this.box(0.04, 0.06, 0.24), aluminium)
    handle.position.set(-0.105, -0.48, 0.46)
    door.add(handle)
    const status = new THREE.Mesh(this.box(0.025, 0.06, 0.38), accent)
    status.position.set(-0.11, 1.47, 0)
    door.add(status)

    for (const z of [-0.9, 0.9]) {
      const jamb = new THREE.Mesh(this.box(0.12, 3.7, 0.14), aluminium)
      jamb.position.set(-0.1, -0.17, z)
      door.add(jamb)
    }
    const head = new THREE.Mesh(this.box(0.12, 0.14, 1.94), aluminium)
    head.position.set(-0.1, 1.68, 0)
    door.add(head)
    const threshold = new THREE.Mesh(this.box(0.38, 0.04, 2.02), aluminium)
    threshold.position.set(-0.02, CABIN_FLOOR_Y + 0.025, 0)
    door.add(threshold)
    const doorLight = new THREE.PointLight(0xa8e4ef, 0.28, 2.6, 2)
    doorLight.position.set(-0.24, 0.5, 0)
    door.add(doorLight)
    door.position.set(COACH_END_DOOR_X - 0.11, 0, 1.48)
    this.group.add(door)
  }

  /** Restrained warm fill keeps the headrest covers and woven seat fabric
   * readable without turning the night coach into a hotel room. */
  private buildCabinLighting() {
    const overhead = new THREE.PointLight(0xffedcf, 0.44, 4.8, 2)
    overhead.position.set(0, 1.72, 0.72)
    this.group.add(overhead)

    const tableFill = new THREE.PointLight(0xffd9a6, 0.18, 2.4, 2)
    tableFill.position.set(0, -1.22, 0.72)
    this.group.add(tableFill)
    for (const side of [-1, 1]) {
      const readingFill = new THREE.PointLight(0xffe4bd, 0.14, 1.8, 2)
      readingFill.position.set(side * 2.28, 0.64, 0.48)
      this.group.add(readingFill)
    }
  }

  /** Flush corridor door with a cool frosted-glass insert. */
  buildCorridorDoor(aluminium: THREE.Material) {
    const doorX = -4.05
    const door = new THREE.Group()

    const doorMat = this.track(
      new THREE.MeshStandardMaterial({ map: this.makeCabinPanelTexture(), roughness: 0.72, metalness: 0.08 })
    )
    const slab = new THREE.Mesh(this.box(1.15, 3.4, 0.06), doorMat)
    door.add(slab)

    const glassMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xd4e8ee, transparent: true, opacity: 0.48, roughness: 0.82,
        emissive: 0xb7e3ed, emissiveIntensity: 0.2,
      })
    )
    const pane = new THREE.Mesh(this.box(0.55, 0.95, 0.02), glassMat)
    pane.position.set(0, 0.75, 0.04)
    door.add(pane)

    const handle = new THREE.Mesh(this.box(0.16, 0.03, 0.05), aluminium)
    handle.position.set(0.38, -0.1, 0.06)
    door.add(handle)
    const plate = new THREE.Mesh(this.box(0.06, 0.14, 0.02), aluminium)
    plate.position.set(0.38, -0.1, 0.045)
    door.add(plate)

    const plaque = new THREE.Mesh(this.box(0.2, 0.08, 0.02), aluminium)
    plaque.position.set(0, 1.45, 0.045)
    door.add(plaque)

    door.position.set(doorX, -0.3, -0.02)
    this.group.add(door)

  }

  /** A compact carriage control panel replaces decorative wall art. */
  buildInfoPanel() {
    const frameMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x20282d, roughness: 0.38, metalness: 0.68 })
    )
    const frame = new THREE.Mesh(this.box(0.58, 0.46, 0.03), frameMat)
    frame.position.set(2.75, 0.05, 0.0)
    this.group.add(frame)
    const displayMat = this.track(
      new THREE.MeshBasicMaterial({ color: 0x98d6db, transparent: true, opacity: 0.75 })
    )
    const display = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.42, 0.08)), displayMat)
    display.position.set(2.75, 0.09, 0.02)
    this.group.add(display)

    const buttonMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xd4e5e7, roughness: 0.32, metalness: 0.65 })
    )
    for (const buttonX of [2.65, 2.85]) {
      const button = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.034, 0.034, 0.018, 12)), buttonMat)
      button.rotation.x = Math.PI / 2
      button.position.set(buttonX, -0.1, 0.035)
      this.group.add(button)
    }
    const indicatorMat = this.track(
      new THREE.MeshBasicMaterial({ color: 0x8ddbe1, transparent: true, opacity: 0.9 })
    )
    const indicator = new THREE.Mesh(this.track(new THREE.CircleGeometry(0.018, 10)), indicatorMat)
    indicator.position.set(2.56, -0.1, 0.04)
    this.group.add(indicator)
  }

  // ---- Glass & sill ----

  private buildGlass() {
    const glass = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(OPENING_W, OPENING_H)),
      this.track(
        new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.06,
          roughness: 0.05,
          metalness: 0,
          depthWrite: false,
        })
      )
    )
    glass.position.y = WINDOW_CENTER_Y
    glass.renderOrder = 10
    this.group.add(glass)

    this.buildGlassReflections()

    // Smudges: soft radial-gradient patches (no hard disc edge) that catch
    // the light very faintly
    const smudgeMat = this.track(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        map: this.makeSoftSpotTexture(),
        transparent: true,
        opacity: 0.05,
        depthWrite: false,
      })
    )
    const smudges: [number, number, number, number][] = [
      [-0.7, 0.3, 0.5, 0.25],
      [0.4, -0.2, 0.7, 0.35],
      [0.9, 0.45, 0.35, 0.2],
    ]
    for (const [sx, sy, sw, sh] of smudges) {
      const patch = new THREE.Mesh(this.track(new THREE.CircleGeometry(0.5, 20)), smudgeMat)
      patch.position.set(sx, sy + WINDOW_CENTER_Y, 0.002)
      patch.scale.set(sw, sh, 1)
      patch.renderOrder = 13
      this.group.add(patch)
    }

    // Dust specks on the glass
    const dustCount = 50
    const dustPositions = new Float32Array(dustCount * 3)
    for (let i = 0; i < dustCount; i++) {
      dustPositions[i * 3] = (Math.random() - 0.5) * OPENING_W
      dustPositions[i * 3 + 1] = WINDOW_CENTER_Y + (Math.random() - 0.5) * OPENING_H
      dustPositions[i * 3 + 2] = 0.003
    }
    const dustGeom = this.track(new THREE.BufferGeometry())
    dustGeom.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3))
    const dustMat = this.track(
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.008,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      })
    )
    const dust = new THREE.Points(dustGeom, dustMat)
    dust.renderOrder = 13
    this.group.add(dust)

    // Rain belongs to the glass plane, not to the exterior precipitation
    // volume. It is intentionally sparse so the side-window view stays open.
    const rainPositions = new Float32Array(RAIN_DROP_COUNT * 3)
    this.rainDropPositions = rainPositions
    for (let i = 0; i < RAIN_DROP_COUNT; i++) this.resetRainDrop(i, true)
    const rainGeom = this.track(new THREE.BufferGeometry())
    rainGeom.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3))
    const rainMat = this.track(new THREE.PointsMaterial({
      color: 0xcce2e9,
      size: 0.028,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      sizeAttenuation: false,
    }))
    const rain = new THREE.Points(rainGeom, rainMat)
    rain.renderOrder = 14
    rain.visible = false
    this.rainDrops = rain
    this.rainDropGeometry = rainGeom
    this.rainDropMaterial = rainMat
    this.group.add(rain)
  }

  /** One quiet lower rail combines the timer and journey state. It belongs on
   * a real cabin surface instead of fighting the 3D projection in screen space. */
  private buildWindowHud() {
    const layout = windowHudSurfaceLayout()
    const rail = this.createHudSurface(1280, 190, layout.rail, 17)
    this.journeyHudCanvas = rail.canvas
    this.journeyHudTexture = rail.texture
    this.journeyHudPlane = rail.plane
    this.drawWindowHud()
    void document.fonts?.load('700 42px Manrope').then(() => this.drawWindowHud())
  }

  private createHudSurface(
    canvasWidth: number,
    canvasHeight: number,
    layout: WindowHudSurfaceLayout['rail'],
    renderOrder: number,
  ) {
    const canvas = document.createElement('canvas')
    canvas.width = canvasWidth
    canvas.height = canvasHeight
    const texture = this.track(new THREE.CanvasTexture(canvas))
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    const material = this.track(new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
      side: THREE.DoubleSide,
    }))
    const plane = new THREE.Mesh(this.track(new THREE.PlaneGeometry(layout.width, layout.height)), material)
    plane.position.set(layout.x, layout.y, layout.z)
    plane.renderOrder = renderOrder
    plane.visible = false
    this.group.add(plane)
    return { canvas, texture, plane }
  }

  private drawWindowHud() {
    if (!this.journeyHudCanvas || !this.journeyHudTexture) return
    this.drawJourneyHud(this.journeyHudCanvas)
    this.journeyHudTexture.needsUpdate = true
  }

  private drawJourneyHud(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d')!
    const { width, height } = canvas
    const left = 64
    const right = width - 64
    const railY = 104
    const railWidth = right - left
    context.clearRect(0, 0, width, height)
    context.fillStyle = 'rgba(8, 13, 16, 0.42)'
    context.fillRect(0, 0, width, height)
    context.fillStyle = 'rgba(190, 220, 226, 0.34)'
    context.fillRect(0, 0, width, 2)
    context.fillRect(0, height - 2, width, 2)

    context.textBaseline = 'middle'
    context.textAlign = 'left'
    context.fillStyle = '#f4f7f5'
    context.font = '700 42px Manrope, ui-sans-serif, system-ui, sans-serif'
    context.fillText(this.windowHud.time, left, 42)
    context.fillStyle = 'rgba(220, 231, 232, 0.82)'
    context.font = '500 20px Manrope, ui-sans-serif, system-ui, sans-serif'
    context.fillText(this.windowHud.journey, left + 174, 42)

    this.drawHudControls(context)

    context.strokeStyle = 'rgba(234, 241, 239, 0.52)'
    context.lineWidth = 4
    context.beginPath()
    context.moveTo(left, railY)
    context.lineTo(right, railY)
    context.stroke()
    context.strokeStyle = '#e4ae43'
    context.lineWidth = 6
    context.beginPath()
    context.moveTo(left, railY)
    context.lineTo(left + railWidth * this.windowHud.progress, railY)
    context.stroke()

    const stationCount = this.windowHud.stationNames.length
    for (let index = 0; index < stationCount; index++) {
      const x = left + railWidth * ((index + 1) / stationCount)
      const reached = index < this.windowHud.currentSegment
      context.fillStyle = reached ? '#e4ae43' : 'rgba(12, 18, 20, 0.84)'
      context.strokeStyle = reached ? '#e4ae43' : 'rgba(236, 243, 242, 0.7)'
      context.lineWidth = 3
      context.beginPath()
      context.arc(x, railY, 9, 0, Math.PI * 2)
      context.fill()
      context.stroke()
      context.fillStyle = 'rgba(233, 241, 240, 0.82)'
      context.font = '500 16px Manrope, ui-sans-serif, system-ui, sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'top'
      context.fillText(this.windowHud.stationNames[index], x, railY + 14)
    }

    context.textBaseline = 'middle'
    context.font = '500 18px Manrope, ui-sans-serif, system-ui, sans-serif'
    context.textAlign = 'right'
    context.fillStyle = 'rgba(235, 242, 241, 0.8)'
    const motion = this.windowHud.motionLabel.split('•').slice(0, 2).join(' • ').trim()
    context.fillText(motion, right, 168)
    const motionWidth = context.measureText(motion).width
    const gradeX = right - motionWidth - 48
    const gradeAngle = THREE.MathUtils.clamp(this.windowHud.grade, -0.02, 0.02) * 360
    context.strokeStyle = '#e4ae43'
    context.lineWidth = 3
    context.beginPath()
    context.moveTo(gradeX, 168)
    context.lineTo(gradeX + 34, 168 - gradeAngle)
    context.stroke()
  }

  /** Draw the icons into the HUD texture itself so their perspective is the
   * same as the timer, route line and every other physical panel detail. */
  private drawHudControls(context: CanvasRenderingContext2D) {
    const controls = windowHudControlCanvasRects()
    const center = (index: number) => controls[index].x + controls[index].width / 2
    const cy = controls[0].y + controls[0].height / 2

    for (const control of controls) {
      context.fillStyle = 'rgba(5, 10, 12, 0.6)'
      context.strokeStyle = 'rgba(203, 223, 226, 0.32)'
      context.lineWidth = 1.5
      context.beginPath()
      context.arc(control.x + control.width / 2, control.y + control.height / 2, control.width / 2 - 1, 0, Math.PI * 2)
      context.fill()
      context.stroke()
    }

    context.strokeStyle = 'rgba(239, 246, 244, 0.94)'
    context.fillStyle = 'rgba(239, 246, 244, 0.94)'
    context.lineWidth = 2.5
    context.lineCap = 'round'
    context.lineJoin = 'round'
    // pause / resume
    if (this.windowHud.paused) {
      context.beginPath()
      context.moveTo(center(0) - 5, cy - 8)
      context.lineTo(center(0) + 8, cy)
      context.lineTo(center(0) - 5, cy + 8)
      context.closePath()
      context.fill()
    } else {
      for (const offset of [-4, 4]) {
        context.beginPath()
        context.moveTo(center(0) + offset, cy - 7)
        context.lineTo(center(0) + offset, cy + 7)
        context.stroke()
      }
    }
    // reset-view
    context.beginPath()
    context.arc(center(1), cy, 8, -Math.PI * 0.15, Math.PI * 1.35)
    context.stroke()
    context.beginPath()
    context.moveTo(center(1) + 8, cy - 7)
    context.lineTo(center(1) + 8, cy - 1)
    context.lineTo(center(1) + 2, cy - 3)
    context.stroke()
    // sound
    const speakerX = center(2) - 8
    context.beginPath()
    context.moveTo(speakerX, cy - 3)
    context.lineTo(speakerX + 4, cy - 3)
    context.lineTo(speakerX + 9, cy - 8)
    context.lineTo(speakerX + 9, cy + 8)
    context.lineTo(speakerX + 4, cy + 3)
    context.lineTo(speakerX, cy + 3)
    context.closePath()
    context.stroke()
    if (this.windowHud.soundEnabled) {
      for (const radius of [6, 10]) {
        context.beginPath()
        context.arc(center(2) + 6, cy, radius, -0.72, 0.72)
        context.stroke()
      }
    } else {
      context.beginPath()
      context.moveTo(center(2) - 8, cy - 9)
      context.lineTo(center(2) + 9, cy + 9)
      context.stroke()
    }
    // fullscreen corners
    const fullX = center(3)
    for (const [dx, dy] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) {
      const sx = fullX + dx
      const sy = cy + dy
      const inset = this.windowHud.fullscreen ? 4 : 0
      context.beginPath()
      context.moveTo(sx - (dx < 0 ? inset : -inset), sy + (dy < 0 ? 5 - inset : -5 + inset))
      context.lineTo(sx - (dx < 0 ? inset : -inset), sy - (dy < 0 ? inset : -inset))
      context.lineTo(sx + (dx < 0 ? 5 - inset : -5 + inset), sy - (dy < 0 ? inset : -inset))
      context.stroke()
    }
    // end-journey flag
    const flagX = center(4) - 7
    context.beginPath()
    context.moveTo(flagX, cy + 9)
    context.lineTo(flagX, cy - 9)
    context.lineTo(flagX + 11, cy - 6)
    context.lineTo(flagX + 11, cy + 1)
    context.lineTo(flagX, cy - 1)
    context.stroke()
  }

  /**
   * The outside world does not need a costly reflection render target for a
   * believable coach window. A cool sky glint and the carriage's warm
   * reading-light shapes are enough at passenger viewing distance, provided
   * they are weaker than the actual landscape and rain layer.
   */
  private buildGlassReflections() {
    const addReflection = (
      texture: THREE.Texture,
      color: number,
      weight: number,
      z: number,
      order: number,
    ) => {
      const material = this.track(new THREE.MeshBasicMaterial({
        color,
        map: texture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }))
      const reflection = new THREE.Mesh(this.track(new THREE.PlaneGeometry(OPENING_W, OPENING_H)), material)
      reflection.position.y = WINDOW_CENTER_Y
      reflection.position.z = z
      reflection.renderOrder = order
      this.group.add(reflection)
      this.glassReflectionMaterials.push({ material, weight })
    }

    addReflection(this.makeCoolGlassReflectionTexture(), 0xbfe9f7, 0.58, 0.004, 11)
    addReflection(this.makeWarmGlassReflectionTexture(), 0xffd7b0, 1, 0.006, 12)
  }

  addSillObjects(accent: THREE.Material) {
    const sillTop = WINDOW_BOTTOM_Y - FRAME_T - 0.03

    const bottleMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x7ca5b0, roughness: 0.3, metalness: 0.38 })
    )
    const bottle = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.05, 0.06, 0.22, 12)), bottleMat)
    bottle.position.set(-0.95, sillTop + 0.13, 0.16)
    this.group.add(bottle)
    this.wobblers.push({ obj: bottle, baseY: bottle.position.y, phase: 0 })

    const tabletMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x182126, roughness: 0.32, metalness: 0.52 })
    )
    const tablet = new THREE.Mesh(this.box(0.52, 0.02, 0.26), tabletMat)
    tablet.position.set(0.24, sillTop + 0.045, 0.19)
    tablet.rotation.y = 0.22
    this.group.add(tablet)
    const screen = new THREE.Mesh(this.box(0.43, 0.005, 0.18), accent)
    screen.position.set(0.24, sillTop + 0.058, 0.2)
    screen.rotation.y = 0.22
    this.group.add(screen)

    const socket = new THREE.Mesh(this.box(0.11, 0.045, 0.025), accent)
    socket.position.set(0.92, sillTop + 0.055, 0.2)
    this.group.add(socket)
  }

  /** Keep a real side-window plane beside the moving camera. It does not
   * follow the look direction: turning the camera must reveal the same
   * perspective skew in the frame and the exterior world. */
  update(
    camera: THREE.PerspectiveCamera,
    time = 0,
    raining = false,
    speedRatio = 0,
    shelter = 0,
    ambientIntensity = 0.45,
  ) {
    const viewport = windowFrameViewportLayout(camera.aspect, this.passengerView)
    this.group.position.set(
      camera.position.x + viewport.frameDistance,
      camera.position.y + viewport.yOffset,
      camera.position.z + viewport.forwardOffset,
    )
    this.group.rotation.set(0, -Math.PI / 2, 0)
    this.group.scale.setScalar(viewport.scale)

    for (const w of this.wobblers) {
      w.obj.position.y = w.baseY + Math.sin(time * 23 + w.phase) * 0.004
      w.obj.rotation.z = Math.sin(time * 17 + w.phase) * 0.02
    }

    const dt = Math.min(0.1, Math.max(0, time - this.lastUpdateTime))
    this.lastUpdateTime = time
    this.updateGlassReflections(ambientIntensity)
    this.updateRainDrops(dt, raining, speedRatio, shelter)
  }

  private updateGlassReflections(ambientIntensity: number) {
    const opacity = glassReflectionOpacity(ambientIntensity)
    for (const reflection of this.glassReflectionMaterials) {
      reflection.material.opacity = opacity * reflection.weight
    }
  }

  private updateRainDrops(dt: number, raining: boolean, speedRatio: number, shelter: number) {
    if (!this.rainDrops || !this.rainDropPositions || !this.rainDropGeometry || !this.rainDropMaterial) return

    const targetOpacity = raining ? 0.52 * (1 - THREE.MathUtils.clamp(shelter, 0, 1)) : 0
    this.rainOpacity += (targetOpacity - this.rainOpacity) * Math.min(1, dt * 4)
    this.rainDropMaterial.opacity = this.rainOpacity
    this.rainDrops.visible = this.rainOpacity > 0.01
    if (!this.rainDrops.visible) return

    const speed = rainDropFallSpeed(speedRatio)
    for (let i = 0; i < RAIN_DROP_COUNT; i++) {
      const y = i * 3 + 1
      this.rainDropPositions[y] -= dt * speed * (0.7 + (i % 5) * 0.1)
      if (this.rainDropPositions[y] < WINDOW_BOTTOM_Y) this.resetRainDrop(i, false)
    }
    ;(this.rainDropGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
  }

  private resetRainDrop(index: number, initial: boolean) {
    if (!this.rainDropPositions) return
    const base = index * 3
    // Keep foreground droplets inside the glazed aperture. Starting them
    // above the opening let a few points flash across the top frame before
    // their first fall update, which reads as weather inside the carriage.
    const top = RAIN_GLASS_TOP
    this.rainDropPositions[base] = (Math.random() - 0.5) * (OPENING_W - 0.12)
    this.rainDropPositions[base + 1] = WINDOW_CENTER_Y + (initial
      ? rainDropInitialY(Math.random())
      : top)
    this.rainDropPositions[base + 2] = 0.012
  }

  // ---- Canvas textures ----

  /** Muted green resilient flooring with the fine ribs and welded seams common
   * in conventional seated coaches. */
  private makeCabinFloorTexture(): THREE.Texture {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#55716a'
    ctx.fillRect(0, 0, size, size)
    for (let x = 0; x < size; x += 5) {
      ctx.fillStyle = x % 20 === 0 ? 'rgba(218, 232, 218, 0.15)' : 'rgba(19, 43, 37, 0.16)'
      ctx.fillRect(x, 0, 1, size)
    }
    for (let y = 18; y < size; y += 54) {
      ctx.fillStyle = 'rgba(9, 15, 18, 0.38)'
      ctx.fillRect(0, y, size, 2)
      ctx.fillStyle = 'rgba(196, 221, 219, 0.1)'
      ctx.fillRect(0, y + 2, size, 1)
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(3, 2)
    texture.colorSpace = THREE.SRGBColorSpace
    return this.track(texture)
  }

  /** Warm ivory laminate with shallow joins and just enough wear to keep the
   * seated-coach shell from reading as a flat showroom surface. */
  private makeCabinPanelTexture(): THREE.Texture {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#f1eee5'
    ctx.fillRect(0, 0, size, size)

    for (let y = 0; y < size; y += 4) {
      const alpha = y % 16 === 0 ? 0.05 : 0.018
      ctx.fillStyle = `rgba(96, 86, 67, ${alpha})`
      ctx.fillRect(0, y, size, 1)
    }
    for (let y = 254; y < size; y += 256) {
      ctx.fillStyle = 'rgba(106, 96, 78, 0.12)'
      ctx.fillRect(0, y, size, 2)
      ctx.fillStyle = 'rgba(255, 252, 240, 0.34)'
      ctx.fillRect(0, y + 2, size, 1)
    }
    for (let x = 20; x < size; x += 48) {
      ctx.fillStyle = 'rgba(248, 239, 220, 0.035)'
      ctx.fillRect(x, 0, 1, size)
    }

    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.colorSpace = THREE.SRGBColorSpace
    return this.track(tex)
  }

  /** Brushed metal grain shared by the frame and cabin fittings. */
  private makeBrushedAluminiumTexture(): THREE.Texture {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#a8b4b9'
    ctx.fillRect(0, 0, size, size)
    for (let y = 0; y < size; y += 3) {
      const alpha = y % 9 === 0 ? 0.2 : 0.07
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`
      ctx.fillRect(0, y, size, 1)
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(2, 2)
    texture.colorSpace = THREE.SRGBColorSpace
    return this.track(texture)
  }

  /** Radial-gradient white spot: opaque center fading to transparent edge. */
  private makeSoftSpotTexture(): THREE.Texture {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    const grad = ctx.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2
    )
    grad.addColorStop(0, 'rgba(255,255,255,0.9)')
    grad.addColorStop(0.5, 'rgba(255,255,255,0.35)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    return this.track(tex)
  }

  /** A thin, diffuse horizon glint; transparent pixels preserve the view. */
  private makeCoolGlassReflectionTexture(): THREE.Texture {
    const width = 384
    const height = 320
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    const sheen = ctx.createLinearGradient(0, height * 0.08, width, height * 0.42)
    sheen.addColorStop(0, 'rgba(255,255,255,0)')
    sheen.addColorStop(0.3, 'rgba(220,245,255,0.42)')
    sheen.addColorStop(0.55, 'rgba(198,232,248,0.14)')
    sheen.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.save()
    ctx.translate(width * 0.05, -height * 0.02)
    ctx.rotate(-0.12)
    ctx.fillStyle = sheen
    ctx.fillRect(-width * 0.15, height * 0.18, width * 1.3, height * 0.12)
    ctx.restore()
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return this.track(texture)
  }

  /** Soft warm shapes mirror the nearby reading lamp and ceiling cove. */
  private makeWarmGlassReflectionTexture(): THREE.Texture {
    const width = 384
    const height = 320
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    const addGlow = (x: number, y: number, radius: number, alpha: number) => {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius)
      glow.addColorStop(0, `rgba(255,239,207,${alpha})`)
      glow.addColorStop(0.45, `rgba(255,202,145,${alpha * 0.32})`)
      glow.addColorStop(1, 'rgba(255,220,185,0)')
      ctx.fillStyle = glow
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
    }
    addGlow(width * 0.79, height * 0.25, height * 0.31, 0.7)
    addGlow(width * 0.24, height * 0.69, height * 0.2, 0.28)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return this.track(texture)
  }

  private box(w: number, h: number, d: number): THREE.BoxGeometry {
    return this.track(new THREE.BoxGeometry(w, h, d))
  }

  private roundedBox(w: number, h: number, d: number, radius: number): RoundedBoxGeometry {
    return this.track(new RoundedBoxGeometry(w, h, d, 5, radius))
  }

  private track<T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(resource: T): T {
    this.disposables.push(resource)
    return resource
  }

  dispose() {
    for (const resource of this.disposables) {
      resource.dispose()
    }
    this.disposables = []
  }
}
