import * as THREE from 'three'

const FRAME_DISTANCE = 2
// Shift the whole cabin down in view so the upper compartment (luggage
// rack, folded bunk) sits inside the visible band instead of hugging the
// top edge, where the app UI covers it.
const GROUP_Y_OFFSET = -0.24
const OPENING_W = 2.6
const OPENING_H = 1.6
const FRAME_T = 0.14
const FRAME_D = 0.08

// Cabin wall is large enough to cover the camera frustum at FRAME_DISTANCE,
// so nothing outside the window opening leaks through at the screen edges.
const WALL_W = 12
const WALL_H = 7

/**
 * European sleeper compartment: walnut-panelled walls, luggage rack with a
 * suitcase, folded upper bunk, brass reading lamp, moquette bench with a
 * lace antimacassar, fold-down table with tea and a book, and a corridor
 * door with frosted glass. Pinned in front of the camera.
 */
export class WindowFrame {
  readonly group = new THREE.Group()
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = []
  private tmpDir = new THREE.Vector3()
  private wobblers: { obj: THREE.Object3D; baseY: number; phase: number }[] = []

  constructor() {
    const wood = this.track(
      new THREE.MeshStandardMaterial({ color: 0x3d2817, roughness: 0.7, metalness: 0.1 })
    )
    const metal = this.track(
      new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.35, metalness: 0.8 })
    )
    const brass = this.track(
      new THREE.MeshStandardMaterial({ color: 0xb08d4a, roughness: 0.32, metalness: 0.85 })
    )
    const wallMat = this.track(
      new THREE.MeshStandardMaterial({ map: this.makeWalnutTexture(), roughness: 0.75, metalness: 0.05 })
    )
    const curtainMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x6e2f28, roughness: 0.95, metalness: 0 })
    )

    const halfW = OPENING_W / 2 + FRAME_T / 2
    const halfH = OPENING_H / 2 + FRAME_T / 2

    this.buildWall(wallMat)
    this.buildFrame(wood, metal, halfW, halfH)
    this.buildTopVent(wood, metal)
    this.buildCurtains(curtainMat, brass)
    this.buildGlass()
    this.buildLuggageRack(brass)
    this.buildFoldedBunk()
    this.buildReadingLamp(brass)
    this.buildSeat()
    this.buildCorridorDoor(brass)
    this.buildWallPrint()
    this.addSillObjects(brass)
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
      new THREE.MeshStandardMaterial({ color: 0x54462f, roughness: 0.8, metalness: 0.05 })
    )
    const trim = new THREE.Mesh(this.box(WALL_W, 0.1, 0.06), trimMat)
    trim.position.set(0, OPENING_H / 2 + 0.45, z + 0.01)
    this.group.add(trim)

    // Warm cove light strip near the ceiling: a soft emissive bar that
    // washes the upper wall in sleeper-train warmth
    const coveMat = this.track(
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.55 })
    )
    const cove = new THREE.Mesh(this.track(new THREE.PlaneGeometry(WALL_W * 0.7, 0.06)), coveMat)
    cove.position.set(0, WALL_H / 2 - 0.35, z + 0.04)
    this.group.add(cove)
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
  private buildTopVent(wood: THREE.Material, metal: THREE.Material) {
    const ventY = OPENING_H / 2 - 0.28
    const bar = new THREE.Mesh(this.box(OPENING_W, 0.05, FRAME_D * 0.8), wood)
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

  /** Heavy draped curtains with a tieback band on each side. */
  private buildCurtains(mat: THREE.Material, brass: THREE.Material) {
    const curtainH = OPENING_H + 0.5
    const slats = 5
    for (const side of [-1, 1]) {
      for (let i = 0; i < slats; i++) {
        const slat = new THREE.Mesh(this.box(0.09, curtainH, 0.04), mat)
        slat.position.set(
          side * (OPENING_W / 2 + FRAME_T + 0.08 + i * 0.085),
          0.05,
          0.05 + Math.sin(i * 1.8) * 0.045
        )
        this.group.add(slat)
      }
      // Tieback band gathering the curtain at mid height
      const band = new THREE.Mesh(this.box(0.06, 0.09, 0.16), brass)
      band.position.set(side * (OPENING_W / 2 + FRAME_T + 0.24), -0.25, 0.08)
      this.group.add(band)
    }
  }

  // ---- Sleeper fittings ----

  /** Luggage rack above the window: walnut shelf + brass rails, with a
   *  strapped leather suitcase and a hat box on board. */
  private buildLuggageRack(brass: THREE.Material) {
    // Luggage rack sits low enough to stay inside the window view frustum
    const rackY = OPENING_H / 2 + 0.15
    const rackZ = 0.3

    // Shelf
    const shelfMat = this.track(
      new THREE.MeshStandardMaterial({ map: this.makeWalnutTexture(), roughness: 0.7, metalness: 0.05 })
    )
    const shelf = new THREE.Mesh(this.box(3.4, 0.04, 0.5), shelfMat)
    shelf.position.set(0.2, rackY, rackZ)
    this.group.add(shelf)

    // Brass guard rails
    const railGeom = this.track(new THREE.CylinderGeometry(0.015, 0.015, 3.4, 8))
    railGeom.rotateZ(Math.PI / 2)
    for (const dy of [0.1, 0.22]) {
      const rail = new THREE.Mesh(railGeom, brass)
      rail.position.set(0.2, rackY + dy, rackZ + 0.24)
      this.group.add(rail)
    }
    // Rail posts
    for (const px of [-1.3, 0.2, 1.7]) {
      const post = new THREE.Mesh(this.box(0.02, 0.24, 0.02), brass)
      post.position.set(px, rackY + 0.12, rackZ + 0.24)
      this.group.add(post)
    }

    // Leather suitcase with straps
    const caseMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x6a4226, roughness: 0.7, metalness: 0.05 })
    )
    const suitcase = new THREE.Group()
    const caseBody = new THREE.Mesh(this.box(0.58, 0.34, 0.2), caseMat)
    suitcase.add(caseBody)
    const strapMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x3a2412, roughness: 0.85 })
    )
    for (const sx of [-0.16, 0.16]) {
      const strap = new THREE.Mesh(this.box(0.035, 0.36, 0.21), strapMat)
      strap.position.x = sx
      suitcase.add(strap)
    }
    const handle = new THREE.Mesh(this.box(0.14, 0.03, 0.03), strapMat)
    handle.position.set(0, 0.19, 0.08)
    suitcase.add(handle)
    suitcase.position.set(-0.75, rackY + 0.19, rackZ)
    suitcase.rotation.y = 0.08
    this.group.add(suitcase)
    this.wobblers.push({ obj: suitcase, baseY: suitcase.position.y, phase: 2.6 })

    // Hat box (round, flat)
    const hatMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x8a7a5c, roughness: 0.8 })
    )
    const hatBox = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 16)), hatMat)
    hatBox.position.set(0.95, rackY + 0.08, rackZ)
    this.group.add(hatBox)
  }

  /** Folded upper bunk: cream mattress edge + blanket roll + leather strap,
   *  tucked against the ceiling at the left. */
  private buildFoldedBunk() {
    // Tucked high on the left wall, just peeking into the top of the view
    const bunkY = 1.35
    const bunk = new THREE.Group()

    const mattressMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xe4dcc6, roughness: 0.95 })
    )
    const mattress = new THREE.Mesh(this.box(1.5, 0.16, 0.5), mattressMat)
    bunk.add(mattress)

    // Folded blanket at the front edge
    const blanketMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x7a3b3b, roughness: 1.0 })
    )
    const blanket = new THREE.Mesh(this.box(1.5, 0.1, 0.14), blanketMat)
    blanket.position.set(0, 0.02, 0.22)
    bunk.add(blanket)

    // Retaining straps
    const strapMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x3a2412, roughness: 0.85 })
    )
    for (const sx of [-0.45, 0.45]) {
      const strap = new THREE.Mesh(this.box(0.04, 0.2, 0.52), strapMat)
      strap.position.x = sx
      bunk.add(strap)
    }

    bunk.position.set(-2.1, bunkY, 0.28)
    this.group.add(bunk)
  }

  /** Brass reading lamp on the right wall: articulated arm, small shade,
   *  warm bulb glow + real point light for the sleeper ambiance. */
  private buildReadingLamp(brass: THREE.Material) {
    const lamp = new THREE.Group()

    // Wall base
    const base = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.05, 0.06, 0.03, 12)), brass)
    base.rotation.x = Math.PI / 2
    lamp.add(base)

    // Two-segment arm reaching out of the wall
    const armGeom = this.track(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 6))
    const arm1 = new THREE.Mesh(armGeom, brass)
    arm1.position.set(0, 0.08, 0.08)
    arm1.rotation.x = -0.7
    lamp.add(arm1)
    const arm2 = new THREE.Mesh(armGeom, brass)
    arm2.position.set(0, 0.16, 0.16)
    arm2.rotation.x = 0.5
    lamp.add(arm2)

    // Shade: small brass cone, warm interior
    const shadeMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xb08d4a, roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide,
      })
    )
    const shade = new THREE.Mesh(this.track(new THREE.ConeGeometry(0.09, 0.1, 12, 1, true)), shadeMat)
    shade.position.set(0, 0.24, 0.2)
    lamp.add(shade)

    // Bulb: warm emissive sphere
    const bulbMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xffe0b0, emissive: 0xffc78a, emissiveIntensity: 2.2, roughness: 0.3,
      })
    )
    const bulb = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.028, 10, 8)), bulbMat)
    bulb.position.set(0, 0.2, 0.2)
    lamp.add(bulb)

    // Real warm light, short range so it only kisses the cabin
    const point = new THREE.PointLight(0xffc78a, 0.55, 3.2, 2)
    point.position.set(0, 0.18, 0.24)
    lamp.add(point)

    // Soft glow sprite around the bulb
    const glowMat = this.track(
      new THREE.MeshBasicMaterial({
        color: 0xffcf96,
        map: this.makeSoftSpotTexture(),
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      })
    )
    const glow = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.45, 0.45)), glowMat)
    glow.position.set(0, 0.2, 0.22)
    glow.renderOrder = 12
    lamp.add(glow)

    lamp.position.set(1.95, 0.35, 0.12)
    this.group.add(lamp)
  }

  /** Opposite bench: moquette fabric back with a white lace antimacassar,
   *  armrest, and the fold-down table edge. */
  private buildSeat() {
    const fabric = this.track(
      new THREE.MeshStandardMaterial({ map: this.makeMoquetteTexture(), roughness: 1.0, metalness: 0 })
    )
    // Seat back rising below the window, tilted slightly toward the viewer
    const seat = new THREE.Mesh(this.box(4.2, 1.6, 0.25), fabric)
    seat.position.set(0.3, -2.35, 0.55)
    seat.rotation.x = 0.12
    this.group.add(seat)

    // White lace headrest cover (antimacassar) draped over the top
    const laceMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xf2eee2, roughness: 0.9 })
    )
    const lace = new THREE.Mesh(this.box(0.62, 0.3, 0.27), laceMat)
    lace.position.set(0.3, -1.62, 0.53)
    lace.rotation.x = 0.12
    this.group.add(lace)

    // Folding table edge attached to the seat back
    const tableMat = this.track(
      new THREE.MeshStandardMaterial({ map: this.makeWalnutTexture(), roughness: 0.6, metalness: 0.05 })
    )
    const table = new THREE.Mesh(this.box(1.6, 0.05, 0.7), tableMat)
    table.position.set(-0.4, -1.75, 0.35)
    table.rotation.x = -0.05
    this.group.add(table)
  }

  /** Corridor door at the far left: walnut slab, frosted glass panel that
   *  glows faintly from the corridor light, brass handle + coat hook. */
  private buildCorridorDoor(brass: THREE.Material) {
    const doorX = -3.6
    const door = new THREE.Group()

    const doorMat = this.track(
      new THREE.MeshStandardMaterial({ map: this.makeWalnutTexture(), roughness: 0.7, metalness: 0.05 })
    )
    const slab = new THREE.Mesh(this.box(1.15, 3.4, 0.06), doorMat)
    door.add(slab)

    // Frosted glass upper panel
    const glassMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xf5ead0, transparent: true, opacity: 0.5, roughness: 0.9,
        emissive: 0xffe8c0, emissiveIntensity: 0.25,
      })
    )
    const pane = new THREE.Mesh(this.box(0.55, 0.95, 0.02), glassMat)
    pane.position.set(0, 0.75, 0.04)
    door.add(pane)

    // Brass handle + lock plate
    const handle = new THREE.Mesh(this.box(0.16, 0.03, 0.05), brass)
    handle.position.set(0.38, -0.1, 0.06)
    door.add(handle)
    const plate = new THREE.Mesh(this.box(0.06, 0.14, 0.02), brass)
    plate.position.set(0.38, -0.1, 0.045)
    door.add(plate)

    // Compartment number plaque
    const plaque = new THREE.Mesh(this.box(0.2, 0.08, 0.02), brass)
    plaque.position.set(0, 1.45, 0.045)
    door.add(plaque)

    door.position.set(doorX, -0.3, -0.02)
    this.group.add(door)

    // Coat hook with a draped scarf beside the door
    const hook = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.025, 8, 6)), brass)
    hook.position.set(doorX + 0.85, 0.9, 0.05)
    this.group.add(hook)
    const scarfMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x8a3a4a, roughness: 1.0, side: THREE.DoubleSide })
    )
    const scarfTop = new THREE.Mesh(this.box(0.14, 0.5, 0.02), scarfMat)
    scarfTop.position.set(doorX + 0.85, 0.62, 0.06)
    scarfTop.rotation.z = 0.06
    this.group.add(scarfTop)
    const scarfTail = new THREE.Mesh(this.box(0.12, 0.3, 0.02), scarfMat)
    scarfTail.position.set(doorX + 0.86, 0.28, 0.055)
    scarfTail.rotation.z = -0.1
    this.group.add(scarfTail)
  }

  /** Small framed landscape print on the right wall. */
  private buildWallPrint() {
    const frameMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x8a6f3a, roughness: 0.4, metalness: 0.6 })
    )
    const frame = new THREE.Mesh(this.box(0.52, 0.4, 0.03), frameMat)
    frame.position.set(2.75, 0.05, 0.0)
    this.group.add(frame)
    const printMat = this.track(
      new THREE.MeshBasicMaterial({ map: this.makePrintTexture() })
    )
    const print = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.44, 0.32)), printMat)
    print.position.set(2.75, 0.05, 0.02)
    this.group.add(print)
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

  private addSillObjects(brass: THREE.Material) {
    const sillTop = -(OPENING_H / 2 + FRAME_T) - 0.03

    // Teacup on a saucer
    const saucer = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.065, 0.05, 0.012, 14)),
      this.track(new THREE.MeshStandardMaterial({ color: 0xf0ead8, roughness: 0.4 }))
    )
    saucer.position.set(-0.8, sillTop + 0.035, 0.16)
    this.group.add(saucer)
    const cup = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.045, 0.035, 0.1, 12)),
      this.track(new THREE.MeshStandardMaterial({ color: 0xd4553a, roughness: 0.5 }))
    )
    cup.position.set(-0.8, sillTop + 0.09, 0.16)
    this.group.add(cup)
    this.wobblers.push({ obj: cup, baseY: cup.position.y, phase: 0 })

    // Open book: two angled leaves meeting at the spine
    const pageMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xf2ecd8, roughness: 0.9 })
    )
    const coverMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x2a4a6a, roughness: 0.8 })
    )
    const book = new THREE.Group()
    const cover = new THREE.Mesh(this.box(0.46, 0.015, 0.17), coverMat)
    book.add(cover)
    for (const side of [-1, 1]) {
      const leaf = new THREE.Mesh(this.box(0.21, 0.012, 0.16), pageMat)
      leaf.position.set(side * 0.105, 0.018, 0)
      leaf.rotation.z = -side * 0.12
      book.add(leaf)
    }
    book.position.set(0.3, sillTop + 0.045, 0.18)
    book.rotation.y = 0.3
    this.group.add(book)

    // Ticket slip poking out from under the book
    const ticketMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xe8d8a8, roughness: 0.85 })
    )
    const ticket = new THREE.Mesh(this.box(0.2, 0.006, 0.08), ticketMat)
    ticket.position.set(0.42, sillTop + 0.032, 0.24)
    ticket.rotation.y = -0.35
    this.group.add(ticket)

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

    // Brass pocket watch on the sill corner
    const watch = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 16)),
      brass
    )
    watch.position.set(-0.45, sillTop + 0.035, 0.2)
    this.group.add(watch)
  }

  /** Pin the interior to the camera: always the same spot in view.
   *  Small items on the sill wobble with the carriage vibration. */
  update(camera: THREE.PerspectiveCamera, time = 0) {
    camera.getWorldDirection(this.tmpDir)
    this.group.position.copy(camera.position).addScaledVector(this.tmpDir, FRAME_DISTANCE)
    this.group.quaternion.copy(camera.quaternion)
    // Drop the cabin slightly (in camera space) — see GROUP_Y_OFFSET
    this.tmpDir.set(0, GROUP_Y_OFFSET, 0).applyQuaternion(camera.quaternion)
    this.group.position.add(this.tmpDir)

    for (const w of this.wobblers) {
      w.obj.position.y = w.baseY + Math.sin(time * 23 + w.phase) * 0.004
      w.obj.rotation.z = Math.sin(time * 17 + w.phase) * 0.02
    }
  }

  // ---- Canvas textures ----

  /** Walnut panelling: warm brown base, vertical grain streaks, panel
   *  grooves — the classic sleeper-compartment wall. */
  private makeWalnutTexture(): THREE.Texture {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#54341f'
    ctx.fillRect(0, 0, size, size)

    // Vertical grain streaks
    for (let i = 0; i < 220; i++) {
      const x = Math.random() * size
      const light = Math.random() < 0.5
      ctx.strokeStyle = light
        ? `rgba(150,100,60,${0.05 + Math.random() * 0.1})`
        : `rgba(30,16,8,${0.06 + Math.random() * 0.12})`
      ctx.lineWidth = 0.6 + Math.random() * 1.8
      ctx.beginPath()
      ctx.moveTo(x, -10)
      ctx.bezierCurveTo(
        x + (Math.random() - 0.5) * 14, size * 0.33,
        x + (Math.random() - 0.5) * 14, size * 0.66,
        x + (Math.random() - 0.5) * 8, size + 10
      )
      ctx.stroke()
    }

    // Panel grooves (vertical boards)
    const boards = 5
    for (let b = 1; b < boards; b++) {
      const x = (b / boards) * size
      ctx.fillStyle = 'rgba(20,10,5,0.55)'
      ctx.fillRect(x - 1.5, 0, 3, size)
      ctx.fillStyle = 'rgba(180,130,85,0.28)'
      ctx.fillRect(x + 1.5, 0, 1, size)
    }

    // Soft sheen band
    const sheen = ctx.createLinearGradient(0, 0, 0, size)
    sheen.addColorStop(0, 'rgba(255,220,170,0.10)')
    sheen.addColorStop(0.4, 'rgba(255,220,170,0.0)')
    ctx.fillStyle = sheen
    ctx.fillRect(0, 0, size, size)

    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.colorSpace = THREE.SRGBColorSpace
    return this.track(tex)
  }

  /** Moquette upholstery: deep red base with a small diamond dot pattern —
   *  the indestructible classic railway fabric. */
  private makeMoquetteTexture(): THREE.Texture {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#5e2c31'
    ctx.fillRect(0, 0, size, size)

    const step = 16
    for (let ry = 0; ry < size / step; ry++) {
      for (let rx = 0; rx < size / step; rx++) {
        const x = rx * step + (ry % 2 === 0 ? 0 : step / 2)
        const y = ry * step
        // Tiny diamond
        ctx.fillStyle = 'rgba(200,168,106,0.55)'
        ctx.beginPath()
        ctx.moveTo(x, y - 3)
        ctx.lineTo(x + 3, y)
        ctx.lineTo(x, y + 3)
        ctx.lineTo(x - 3, y)
        ctx.closePath()
        ctx.fill()
        // Offset blue-grey pin dot
        ctx.fillStyle = 'rgba(90,110,140,0.5)'
        ctx.fillRect(x + step / 2 - 1, y + step / 2 - 1, 2, 2)
      }
    }

    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(6, 3)
    tex.colorSpace = THREE.SRGBColorSpace
    return this.track(tex)
  }

  /** Miniature landscape print for the wall frame. */
  private makePrintTexture(): THREE.Texture {
    const w = 128, h = 96
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.6)
    sky.addColorStop(0, '#e8d8b0')
    sky.addColorStop(1, '#c8d8e0')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, w, h * 0.6)
    // Distant hills
    ctx.fillStyle = '#8a9a7a'
    ctx.beginPath()
    ctx.moveTo(0, h * 0.55)
    ctx.quadraticCurveTo(w * 0.3, h * 0.35, w * 0.6, h * 0.52)
    ctx.quadraticCurveTo(w * 0.8, h * 0.62, w, h * 0.5)
    ctx.lineTo(w, h * 0.65)
    ctx.lineTo(0, h * 0.65)
    ctx.closePath()
    ctx.fill()
    // Field
    ctx.fillStyle = '#a89858'
    ctx.fillRect(0, h * 0.62, w, h * 0.38)
    // A copse
    ctx.fillStyle = '#5a6a42'
    ctx.beginPath()
    ctx.arc(w * 0.75, h * 0.58, 8, 0, Math.PI * 2)
    ctx.arc(w * 0.82, h * 0.6, 6, 0, Math.PI * 2)
    ctx.fill()
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    return this.track(tex)
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
