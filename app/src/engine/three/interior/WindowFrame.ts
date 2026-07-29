import * as THREE from 'three'

const FRAME_DISTANCE = 2
const WINDOW_FORWARD_OFFSET = 0.5
// Shift the whole cabin down in view so the upper compartment (luggage
// rack, folded bunk) sits inside the visible band instead of hugging the
// top edge, where the app UI covers it.
const GROUP_Y_OFFSET = -0.1
const OPENING_W = 3.5
const OPENING_H = 2.9
const FRAME_T = 0.14
const FRAME_D = 0.08

// Cabin wall is large enough to cover the camera frustum at FRAME_DISTANCE,
// so nothing outside the window opening leaks through at the screen edges.
const WALL_W = 12
const WALL_H = 7
const RAIN_DROP_COUNT = 96
const RAIN_GLASS_TOP = OPENING_H / 2 - 0.05

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
}

export type WindowHudSurfaceLayout = {
  top: { x: number; y: number; z: number; width: number; height: number }
  bottom: { x: number; y: number; z: number; width: number; height: number }
}

/** Passive rails occupy real cabin/window planes. Their perspective comes
 * from the same camera projection as the frame, not from a CSS approximation. */
export function windowHudSurfaceLayout(): WindowHudSurfaceLayout {
  return {
    top: { x: 0.05, y: 1.08, z: 0.035, width: 1.92, height: 0.34 },
    bottom: { x: -0.02, y: -1.08, z: 0.035, width: 3.08, height: 0.52 },
  }
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
 * Modern European sleeper compartment: a body-aligned panoramic window,
 * soft-grey panels, aluminium fittings, blue-grey textiles and low-glare
 * LED lighting. The perspective follows the exterior world axes.
 */
export class WindowFrame {
  readonly group = new THREE.Group()
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
  }
  private topHudCanvas: HTMLCanvasElement | null = null
  private topHudTexture: THREE.CanvasTexture | null = null
  private topHudPlane: THREE.Mesh | null = null
  private bottomHudCanvas: HTMLCanvasElement | null = null
  private bottomHudTexture: THREE.CanvasTexture | null = null
  private bottomHudPlane: THREE.Mesh | null = null

  constructor() {
    const frame = this.track(
      new THREE.MeshStandardMaterial({ color: 0x20282d, roughness: 0.5, metalness: 0.28 })
    )
    const aluminium = this.track(
      new THREE.MeshStandardMaterial({ color: 0xa8b4b9, roughness: 0.3, metalness: 0.85 })
    )
    const accent = this.track(
      new THREE.MeshStandardMaterial({ color: 0x76b4c8, roughness: 0.38, metalness: 0.45 })
    )
    const wallMat = this.track(
      new THREE.MeshStandardMaterial({ map: this.makeCabinPanelTexture(), roughness: 0.82, metalness: 0.05 })
    )
    const blindMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x42505a, roughness: 0.72, metalness: 0.12 })
    )

    const halfW = OPENING_W / 2 + FRAME_T / 2
    const halfH = OPENING_H / 2 + FRAME_T / 2

    this.buildWall(wallMat)
    this.buildFrame(frame, aluminium, halfW, halfH)
    this.buildTopVent(frame, aluminium)
    this.buildRollerBlind(blindMat, accent)
    this.buildGlass()
    this.buildWindowHud()
    this.buildLuggageRack(aluminium)
    this.buildFoldedBunk(aluminium)
    this.buildReadingLamp(aluminium)
    this.buildSeat()
    this.buildCorridorDoor(aluminium)
    this.buildInfoPanel()
    this.addSillObjects(accent)
    this.buildCabinLighting()
    this.promoteToForeground()
  }

  setHudReadout(readout: WindowHudReadout) {
    this.windowHud = {
      ...readout,
      progress: clampWindowHudProgress(readout.progress),
      currentSegment: Math.max(0, Math.floor(readout.currentSegment)),
    }
    if (this.topHudPlane) this.topHudPlane.visible = readout.visible
    if (this.bottomHudPlane) this.bottomHudPlane.visible = readout.visible
    if (!readout.visible) return
    this.drawWindowHud()
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

  /** Cabin wall panels surrounding the window opening (behind the frame). */
  private buildWall(mat: THREE.Material) {
    const sideW = (WALL_W - OPENING_W) / 2
    const topBotH = (WALL_H - OPENING_H) / 2
    const z = -0.06

    // Left / right full-height panels
    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(this.box(sideW, WALL_H, 0.05), mat)
      panel.position.set(side * (OPENING_W / 2 + sideW / 2), 0, z)
      this.group.add(panel)
    }
    // Top / bottom panels spanning the opening
    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(this.box(OPENING_W, topBotH, 0.05), mat)
      panel.position.set(0, side * (OPENING_H / 2 + topBotH / 2), z)
      this.group.add(panel)
    }

    // Soft wall trim strip above the window for a finished look
    const trimMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x9daab0, roughness: 0.62, metalness: 0.28 })
    )
    const trim = new THREE.Mesh(this.box(WALL_W, 0.1, 0.06), trimMat)
    trim.position.set(0, OPENING_H / 2 + 0.45, z + 0.01)
    this.group.add(trim)

    // Diffused ceiling strip: warm enough for a night train, but neutral and
    // architectural rather than a vintage carriage glow.
    const coveMat = this.track(
      new THREE.MeshBasicMaterial({ color: 0xffe7c2, transparent: true, opacity: 0.6 })
    )
    const cove = new THREE.Mesh(this.track(new THREE.PlaneGeometry(WALL_W * 0.7, 0.06)), coveMat)
    cove.position.set(0, WALL_H / 2 - 0.35, z + 0.04)
    this.group.add(cove)
  }

  private buildFrame(frame: THREE.Material, metal: THREE.Material, halfW: number, halfH: number) {
    // Left / right pillars
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(this.box(FRAME_T, OPENING_H + FRAME_T * 2, FRAME_D), frame)
      pillar.position.set(side * halfW, 0, 0)
      this.group.add(pillar)
    }
    // Top bar
    const top = new THREE.Mesh(this.box(OPENING_W + FRAME_T * 2, FRAME_T, FRAME_D), frame)
    top.position.set(0, halfH, 0)
    this.group.add(top)
    // Bottom frame bar
    const bottom = new THREE.Mesh(this.box(OPENING_W + FRAME_T * 2, FRAME_T, FRAME_D), frame)
    bottom.position.set(0, -halfH, 0)
    this.group.add(bottom)

    // Window sill: extends toward the viewer, holds small objects
    const sill = new THREE.Mesh(this.box(OPENING_W + FRAME_T * 2, 0.06, 0.3), frame)
    sill.position.set(0, -halfH - 0.06, 0.16)
    this.group.add(sill)

    // Rubber seal around the glass edge (classic carriage window gasket)
    const sealMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95, metalness: 0 })
    )
    const sealW = 0.035
    for (const side of [-1, 1]) {
      const seal = new THREE.Mesh(this.box(sealW, OPENING_H, 0.02), sealMat)
      seal.position.set(side * (OPENING_W / 2 - sealW / 2), 0, 0.045)
      this.group.add(seal)
    }
    for (const side of [-1, 1]) {
      const seal = new THREE.Mesh(this.box(OPENING_W, sealW, 0.02), sealMat)
      seal.position.set(0, side * (OPENING_H / 2 - sealW / 2), 0.045)
      this.group.add(seal)
    }

    // Metal trim along the inner edges
    const trimV = this.box(0.02, OPENING_H, FRAME_D + 0.01)
    for (const side of [-1, 1]) {
      const trim = new THREE.Mesh(trimV, metal)
      trim.position.set(side * (OPENING_W / 2 + 0.01), 0, 0)
      this.group.add(trim)
    }

    // Brass window latch on the right pillar
    const latch = new THREE.Mesh(this.box(0.05, 0.12, 0.05), metal)
    latch.position.set(halfW - 0.1, 0.1, 0.06)
    this.group.add(latch)
  }

  /** Top vent: a horizontal division bar splitting off a small hopper
   *  window — the signature of European carriage windows. */
  private buildTopVent(frame: THREE.Material, metal: THREE.Material) {
    const ventY = OPENING_H / 2 - 0.28
    const bar = new THREE.Mesh(this.box(OPENING_W, 0.05, FRAME_D * 0.8), frame)
    bar.position.set(0, ventY, 0.01)
    this.group.add(bar)
    // Vent hinge knobs
    for (const side of [-1, 1]) {
      const knob = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.018, 0.018, 0.05, 8)), metal)
      knob.rotation.x = Math.PI / 2
      knob.position.set(side * (OPENING_W / 2 - 0.12), ventY, 0.05)
      this.group.add(knob)
    }
  }

  /** Flush roller blind cassette and slim guide rails used in new sleepers. */
  private buildRollerBlind(blindMat: THREE.Material, accent: THREE.Material) {
    const cassette = new THREE.Mesh(this.box(OPENING_W + FRAME_T * 2, 0.13, 0.12), blindMat)
    cassette.position.set(0, OPENING_H / 2 + 0.17, 0.08)
    this.group.add(cassette)

    const blind = new THREE.Mesh(this.box(OPENING_W - 0.08, 0.18, 0.018), blindMat)
    blind.position.set(0, OPENING_H / 2 - 0.18, 0.06)
    this.group.add(blind)

    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(this.box(0.035, OPENING_H, 0.04), accent)
      rail.position.set(side * (OPENING_W / 2 - 0.055), 0, 0.055)
      this.group.add(rail)
    }
  }

  // ---- Sleeper fittings ----

  /** Aluminium luggage rail with a compact soft case. */
  private buildLuggageRack(aluminium: THREE.Material) {
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

  /** Folded upper berth with a slim safety rail. */
  private buildFoldedBunk(aluminium: THREE.Material) {
    const bunkY = 1.35
    const bunk = new THREE.Group()

    const mattressMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xd8e0e2, roughness: 0.95 })
    )
    const mattress = new THREE.Mesh(this.box(1.5, 0.16, 0.5), mattressMat)
    bunk.add(mattress)

    const blanketMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x31546a, roughness: 1.0 })
    )
    const blanket = new THREE.Mesh(this.box(1.5, 0.1, 0.14), blanketMat)
    blanket.position.set(0, 0.02, 0.22)
    bunk.add(blanket)

    for (const sx of [-0.45, 0.45]) {
      const bracket = new THREE.Mesh(this.box(0.04, 0.2, 0.52), aluminium)
      bracket.position.x = sx
      bunk.add(bracket)
    }

    bunk.position.set(-1.72, bunkY, 0.28)
    this.group.add(bunk)
  }

  /** Compact LED reading light with a flush wall base. */
  private buildReadingLamp(aluminium: THREE.Material) {
    const lamp = new THREE.Group()

    const base = new THREE.Mesh(this.box(0.18, 0.12, 0.035), aluminium)
    lamp.add(base)

    const arm = new THREE.Mesh(this.box(0.04, 0.26, 0.04), aluminium)
    arm.position.set(0, 0.12, 0.07)
    arm.rotation.x = -0.42
    lamp.add(arm)

    const housing = new THREE.Mesh(this.box(0.24, 0.07, 0.13), aluminium)
    housing.position.set(0, 0.25, 0.16)
    lamp.add(housing)

    const bulbMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xf5fbff, emissive: 0xd8f2ff, emissiveIntensity: 1.8, roughness: 0.2,
      })
    )
    const bulb = new THREE.Mesh(this.box(0.16, 0.018, 0.07), bulbMat)
    bulb.position.set(0, 0.22, 0.23)
    lamp.add(bulb)

    const point = new THREE.PointLight(0xffe8cf, 0.5, 3.2, 2)
    point.position.set(0, 0.22, 0.24)
    lamp.add(point)

    const glowMat = this.track(
      new THREE.MeshBasicMaterial({
        color: 0xd8f2ff,
        map: this.makeSoftSpotTexture(),
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      })
    )
    const glow = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.36, 0.36)), glowMat)
    glow.position.set(0, 0.22, 0.25)
    glow.renderOrder = 12
    lamp.add(glow)

    lamp.position.set(1.95, 0.35, 0.12)
    this.group.add(lamp)
  }

  /** Deep blue-grey berth bench with a compact laminate work surface. */
  private buildSeat() {
    const fabric = this.track(
      new THREE.MeshStandardMaterial({ map: this.makeSeatTextile(), roughness: 1.0, metalness: 0 })
    )
    const seat = new THREE.Mesh(this.box(4.3, 0.72, 0.28), fabric)
    seat.position.set(0.25, -2.02, 0.62)
    seat.rotation.x = 0.12
    this.group.add(seat)

    const edgeMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x9fc8d5, roughness: 0.42, metalness: 0.42 })
    )
    const topPiping = new THREE.Mesh(this.box(4.34, 0.03, 0.035), edgeMat)
    topPiping.position.set(0.25, -1.67, 0.79)
    topPiping.rotation.x = 0.12
    this.group.add(topPiping)
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(this.box(0.12, 0.34, 0.4), edgeMat)
      arm.position.set(0.25 + side * 2.05, -1.92, 0.56)
      arm.rotation.x = 0.12
      this.group.add(arm)
    }

    const tableMat = this.track(
      new THREE.MeshStandardMaterial({ map: this.makeCabinPanelTexture(), roughness: 0.58, metalness: 0.08 })
    )
    const table = new THREE.Mesh(this.box(1.65, 0.05, 0.66), tableMat)
    table.position.set(-0.55, -1.88, 0.43)
    table.rotation.x = -0.05
    this.group.add(table)

    const blanketMat = this.track(
      new THREE.MeshStandardMaterial({ map: this.makeBeddingTexture(), roughness: 0.98 })
    )
    const blanket = new THREE.Mesh(this.box(1.35, 0.06, 0.35), blanketMat)
    blanket.position.set(1.25, -1.68, 0.82)
    blanket.rotation.x = 0.12
    this.group.add(blanket)
  }

  /** Neutral warm fills keep the modern interior readable at night. */
  private buildCabinLighting() {
    const overhead = new THREE.PointLight(0xffc98e, 0.72, 4.6, 2)
    overhead.position.set(-0.15, 1.95, 0.48)
    this.group.add(overhead)

    const berthFill = new THREE.PointLight(0xffd7a2, 0.24, 2.6, 2)
    berthFill.position.set(-1.2, -0.45, 0.48)
    this.group.add(berthFill)
  }

  /** Flush corridor door with a cool frosted-glass insert. */
  private buildCorridorDoor(aluminium: THREE.Material) {
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

  /** A muted digital route display replaces decorative vintage wall art. */
  private buildInfoPanel() {
    const frameMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x20282d, roughness: 0.38, metalness: 0.68 })
    )
    const frame = new THREE.Mesh(this.box(0.52, 0.4, 0.03), frameMat)
    frame.position.set(2.75, 0.05, 0.0)
    this.group.add(frame)
    const displayMat = this.track(
      new THREE.MeshBasicMaterial({ color: 0x98d6db, transparent: true, opacity: 0.75 })
    )
    const display = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.42, 0.08)), displayMat)
    display.position.set(2.75, 0.09, 0.02)
    this.group.add(display)
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
      patch.position.set(sx, sy, 0.002)
      patch.scale.set(sw, sh, 1)
      patch.renderOrder = 13
      this.group.add(patch)
    }

    // Dust specks on the glass
    const dustCount = 50
    const dustPositions = new Float32Array(dustCount * 3)
    for (let i = 0; i < dustCount; i++) {
      dustPositions[i * 3] = (Math.random() - 0.5) * OPENING_W
      dustPositions[i * 3 + 1] = (Math.random() - 0.5) * OPENING_H
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

  /** The timer and journey rail are passive, so they can live on real cabin
   * surfaces instead of fighting the 3D projection from a screen-space layer. */
  private buildWindowHud() {
    const layout = windowHudSurfaceLayout()
    const top = this.createHudSurface(840, 190, layout.top, 16)
    this.topHudCanvas = top.canvas
    this.topHudTexture = top.texture
    this.topHudPlane = top.plane

    const bottom = this.createHudSurface(1280, 250, layout.bottom, 17)
    this.bottomHudCanvas = bottom.canvas
    this.bottomHudTexture = bottom.texture
    this.bottomHudPlane = bottom.plane
    this.drawWindowHud()
  }

  private createHudSurface(
    canvasWidth: number,
    canvasHeight: number,
    layout: WindowHudSurfaceLayout['top'],
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
    if (!this.topHudCanvas || !this.topHudTexture || !this.bottomHudCanvas || !this.bottomHudTexture) return
    this.drawTopHud(this.topHudCanvas)
    this.drawBottomHud(this.bottomHudCanvas)
    this.topHudTexture.needsUpdate = true
    this.bottomHudTexture.needsUpdate = true
  }

  private drawTopHud(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d')!
    const { width, height } = canvas
    context.clearRect(0, 0, width, height)
    context.fillStyle = 'rgba(8, 13, 16, 0.42)'
    context.fillRect(0, 0, width, height)
    context.fillStyle = 'rgba(190, 220, 226, 0.42)'
    context.fillRect(0, 0, width, 3)
    context.fillRect(0, height - 3, width, 3)

    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillStyle = '#f4f7f5'
    context.font = '700 92px ui-monospace, SFMono-Regular, Menlo, monospace'
    context.fillText(this.windowHud.time, width / 2, height * 0.47)
    context.fillStyle = 'rgba(220, 231, 232, 0.8)'
    context.font = '500 27px system-ui, sans-serif'
    context.fillText(this.windowHud.journey, width / 2, height * 0.79)
  }

  private drawBottomHud(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d')!
    const { width, height } = canvas
    const left = 64
    const right = width - 64
    const railY = 72
    const railWidth = right - left
    context.clearRect(0, 0, width, height)
    context.fillStyle = 'rgba(8, 13, 16, 0.34)'
    context.fillRect(0, 0, width, height)
    context.fillStyle = 'rgba(190, 220, 226, 0.34)'
    context.fillRect(0, 0, width, 2)
    context.fillRect(0, height - 2, width, 2)

    context.strokeStyle = 'rgba(234, 241, 239, 0.52)'
    context.lineWidth = 5
    context.beginPath()
    context.moveTo(left, railY)
    context.lineTo(right, railY)
    context.stroke()
    context.strokeStyle = '#e4ae43'
    context.lineWidth = 7
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
      context.lineWidth = 4
      context.beginPath()
      context.arc(x, railY, 12, 0, Math.PI * 2)
      context.fill()
      context.stroke()
      context.fillStyle = 'rgba(233, 241, 240, 0.82)'
      context.font = '500 22px system-ui, sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'top'
      context.fillText(this.windowHud.stationNames[index], x, railY + 21)
    }

    context.textBaseline = 'middle'
    context.font = '500 24px system-ui, sans-serif'
    context.fillStyle = 'rgba(235, 242, 241, 0.75)'
    context.textAlign = 'left'
    context.fillText(this.windowHud.segmentLabel, left, 182)
    context.textAlign = 'center'
    context.fillStyle = 'rgba(235, 242, 241, 0.86)'
    context.fillText(this.windowHud.routeLabel, width / 2, 182)
    context.textAlign = 'right'
    context.fillStyle = 'rgba(235, 242, 241, 0.76)'
    context.fillText(this.windowHud.motionLabel, right, 182)
    const motionWidth = context.measureText(this.windowHud.motionLabel).width
    const gradeX = right - motionWidth - 48
    const gradeAngle = THREE.MathUtils.clamp(this.windowHud.grade, -0.02, 0.02) * 620
    context.strokeStyle = '#e4ae43'
    context.lineWidth = 4
    context.beginPath()
    context.moveTo(gradeX, 182)
    context.lineTo(gradeX + 34, 182 - gradeAngle)
    context.stroke()
  }

  /**
   * The outside world does not need a costly reflection render target for a
   * believable sleeper window. A cool sky glint and the carriage's warm
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
      reflection.position.z = z
      reflection.renderOrder = order
      this.group.add(reflection)
      this.glassReflectionMaterials.push({ material, weight })
    }

    addReflection(this.makeCoolGlassReflectionTexture(), 0xbfe9f7, 0.58, 0.004, 11)
    addReflection(this.makeWarmGlassReflectionTexture(), 0xffd7b0, 1, 0.006, 12)
  }

  private addSillObjects(accent: THREE.Material) {
    const sillTop = -(OPENING_H / 2 + FRAME_T) - 0.03

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
    this.group.position.set(
      camera.position.x + FRAME_DISTANCE,
      camera.position.y + GROUP_Y_OFFSET,
      camera.position.z + WINDOW_FORWARD_OFFSET,
    )
    this.group.rotation.set(0, -Math.PI / 2, 0)

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
      if (this.rainDropPositions[y] < -OPENING_H / 2) this.resetRainDrop(i, false)
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
    this.rainDropPositions[base + 1] = initial
      ? rainDropInitialY(Math.random())
      : top
    this.rainDropPositions[base + 2] = 0.012
  }

  // ---- Canvas textures ----

  /** Light-grey composite panels with recessed joins. */
  private makeCabinPanelTexture(): THREE.Texture {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#c8d0d1'
    ctx.fillRect(0, 0, size, size)

    for (let y = 32; y < size; y += 64) {
      ctx.fillStyle = 'rgba(37,52,58,0.18)'
      ctx.fillRect(0, y, size, 2)
      ctx.fillStyle = 'rgba(255,255,255,0.24)'
      ctx.fillRect(0, y + 2, size, 1)
    }

    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.colorSpace = THREE.SRGBColorSpace
    return this.track(tex)
  }

  /** Blue-grey woven seat textile with a restrained geometric weave. */
  private makeSeatTextile(): THREE.Texture {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#334b5c'
    ctx.fillRect(0, 0, size, size)

    const step = 12
    for (let ry = 0; ry < size / step; ry++) {
      for (let rx = 0; rx < size / step; rx++) {
        const x = rx * step + (ry % 2 === 0 ? 0 : step / 2)
        const y = ry * step
        ctx.fillStyle = 'rgba(190,220,225,0.3)'
        ctx.fillRect(x, y, 2, 2)
        ctx.fillStyle = 'rgba(23,35,46,0.28)'
        ctx.fillRect(x + step / 2, y + step / 2, 2, 2)
      }
    }

    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(6, 3)
    tex.colorSpace = THREE.SRGBColorSpace
    return this.track(tex)
  }

  /** Navy bedding with a subtle cool pinstripe. */
  private makeBeddingTexture(): THREE.Texture {
    const size = 96
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#34546a'
    ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = 'rgba(202,224,230,0.38)'
    for (let x = 8; x < size; x += 24) ctx.fillRect(x, 0, 1, size)
    for (let y = 12; y < size; y += 20) ctx.fillRect(0, y, size, 1)
    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(3, 2)
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

  /** Soft warm shapes mirror the nearby berth lamp and ceiling cove. */
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
