import * as THREE from 'three'

const FRAME_DISTANCE = 2
const OPENING_W = 2.6
const OPENING_H = 1.6
const FRAME_T = 0.14
const FRAME_D = 0.08

// Cabin wall is large enough to cover the camera frustum at FRAME_DISTANCE,
// so nothing outside the window opening leaks through at the screen edges.
const WALL_W = 12
const WALL_H = 7

/**
 * Train window + surrounding cabin interior, pinned in front of the camera.
 * Gives the "sitting inside a train, looking out of the side window" feel.
 */
export class WindowFrame {
  readonly group = new THREE.Group()
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = []
  private tmpDir = new THREE.Vector3()
  private wobblers: { obj: THREE.Object3D; baseY: number; phase: number }[] = []

  constructor() {
    const wood = this.track(
      new THREE.MeshStandardMaterial({ color: 0x3d2817, roughness: 0.7, metalness: 0.1 })
    )
    const metal = this.track(
      new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.35, metalness: 0.8 })
    )
    const wallMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x6e5f4e, roughness: 0.95, metalness: 0 })
    )
    const curtainMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x7a3b2e, roughness: 0.9, metalness: 0 })
    )

    const halfW = OPENING_W / 2 + FRAME_T / 2
    const halfH = OPENING_H / 2 + FRAME_T / 2

    this.buildWall(wallMat)
    this.buildFrame(wood, metal, halfW, halfH)
    this.buildCurtains(curtainMat)
    this.buildGlass()
    this.buildSeat()
    this.addSillObjects()
  }

  /** Opposite seat back + folding table silhouette at the bottom of the view. */
  private buildSeat() {
    const fabric = this.track(
      new THREE.MeshStandardMaterial({ color: 0x2e3a4a, roughness: 1.0, metalness: 0 })
    )
    // Seat back rising below the window, tilted slightly toward the viewer
    const seat = new THREE.Mesh(this.box(4.2, 1.6, 0.25), fabric)
    seat.position.set(0.3, -2.35, 0.55)
    seat.rotation.x = 0.12
    this.group.add(seat)

    // Folding table edge attached to the seat back
    const tableMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x8a7a5f, roughness: 0.6, metalness: 0.05 })
    )
    const table = new THREE.Mesh(this.box(1.6, 0.05, 0.7), tableMat)
    table.position.set(-0.4, -1.75, 0.35)
    table.rotation.x = -0.05
    this.group.add(table)
  }

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
      new THREE.MeshStandardMaterial({ color: 0x54462f, roughness: 0.8, metalness: 0.05 })
    )
    const trim = new THREE.Mesh(this.box(WALL_W, 0.1, 0.06), trimMat)
    trim.position.set(0, OPENING_H / 2 + 0.45, z + 0.01)
    this.group.add(trim)
  }

  private buildFrame(wood: THREE.Material, metal: THREE.Material, halfW: number, halfH: number) {
    // Left / right pillars
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(this.box(FRAME_T, OPENING_H + FRAME_T * 2, FRAME_D), wood)
      pillar.position.set(side * halfW, 0, 0)
      this.group.add(pillar)
    }
    // Top bar
    const top = new THREE.Mesh(this.box(OPENING_W + FRAME_T * 2, FRAME_T, FRAME_D), wood)
    top.position.set(0, halfH, 0)
    this.group.add(top)
    // Bottom frame bar
    const bottom = new THREE.Mesh(this.box(OPENING_W + FRAME_T * 2, FRAME_T, FRAME_D), wood)
    bottom.position.set(0, -halfH, 0)
    this.group.add(bottom)

    // Window sill: extends toward the viewer, holds small objects
    const sill = new THREE.Mesh(this.box(OPENING_W + FRAME_T * 2, 0.06, 0.3), wood)
    sill.position.set(0, -halfH - 0.06, 0.16)
    this.group.add(sill)

    // Metal trim along the inner edges
    const trimV = this.box(0.02, OPENING_H, FRAME_D + 0.01)
    for (const side of [-1, 1]) {
      const trim = new THREE.Mesh(trimV, metal)
      trim.position.set(side * (OPENING_W / 2 + 0.01), 0, 0)
      this.group.add(trim)
    }

    // Window latch detail on the right pillar
    const latch = new THREE.Mesh(this.box(0.05, 0.12, 0.05), metal)
    latch.position.set(halfW - 0.1, 0.1, 0.06)
    this.group.add(latch)
  }

  /** Side curtains: a few slats per side faking fabric folds. */
  private buildCurtains(mat: THREE.Material) {
    const curtainH = OPENING_H + 0.5
    const slats = 4
    for (const side of [-1, 1]) {
      for (let i = 0; i < slats; i++) {
        const slat = new THREE.Mesh(this.box(0.09, curtainH, 0.04), mat)
        slat.position.set(
          side * (OPENING_W / 2 + FRAME_T + 0.08 + i * 0.085),
          0.05,
          0.05 + (i % 2) * 0.035
        )
        this.group.add(slat)
      }
    }
  }

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

    // Smudges: a few soft elliptical patches that catch the light faintly
    const smudgeMat = this.track(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.035,
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
      patch.renderOrder = 11
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
    dust.renderOrder = 11
    this.group.add(dust)
  }

  private addSillObjects() {
    const sillTop = -(OPENING_H / 2 + FRAME_T) - 0.03

    // Cup
    const cup = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.045, 0.035, 0.1, 12)),
      this.track(new THREE.MeshStandardMaterial({ color: 0xd4553a, roughness: 0.5 }))
    )
    cup.position.set(-0.8, sillTop + 0.08, 0.16)
    this.group.add(cup)
    this.wobblers.push({ obj: cup, baseY: cup.position.y, phase: 0 })

    // Book (flat box, slightly rotated)
    const book = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(0.22, 0.03, 0.16)),
      this.track(new THREE.MeshStandardMaterial({ color: 0x2a4a6a, roughness: 0.8 }))
    )
    book.position.set(0.3, sillTop + 0.045, 0.18)
    book.rotation.y = 0.3
    this.group.add(book)

    // Small plant pot
    const pot = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.05, 0.04, 0.08, 10)),
      this.track(new THREE.MeshStandardMaterial({ color: 0xa0643c, roughness: 0.9 }))
    )
    pot.position.set(0.85, sillTop + 0.07, 0.15)
    this.group.add(pot)
    const plant = new THREE.Mesh(
      this.track(new THREE.IcosahedronGeometry(0.06, 0)),
      this.track(new THREE.MeshStandardMaterial({ color: 0x3f7a3f, roughness: 0.8, flatShading: true }))
    )
    plant.position.set(0.85, sillTop + 0.16, 0.15)
    this.group.add(plant)
    this.wobblers.push({ obj: plant, baseY: plant.position.y, phase: 1.7 })
  }

  /** Pin the interior to the camera: always the same spot in view.
   *  Small items on the sill wobble with the carriage vibration. */
  update(camera: THREE.PerspectiveCamera, time = 0) {
    camera.getWorldDirection(this.tmpDir)
    this.group.position.copy(camera.position).addScaledVector(this.tmpDir, FRAME_DISTANCE)
    this.group.quaternion.copy(camera.quaternion)

    for (const w of this.wobblers) {
      w.obj.position.y = w.baseY + Math.sin(time * 23 + w.phase) * 0.004
      w.obj.rotation.z = Math.sin(time * 17 + w.phase) * 0.02
    }
  }

  private box(w: number, h: number, d: number): THREE.BoxGeometry {
    return this.track(new THREE.BoxGeometry(w, h, d))
  }

  private track<T extends THREE.BufferGeometry | THREE.Material>(resource: T): T {
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
