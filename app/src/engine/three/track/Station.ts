import * as THREE from 'three'

// Platform dimensions — long enough to feel like a real station
const PLATFORM_LENGTH = 300
const PLATFORM_WIDTH = 7
const PLATFORM_HEIGHT = 1.1
const PLATFORM_X = 6 // center of platform from track center
const EDGE_LINE_W = 0.35

// Canopy
const CANOPY_LENGTH = 180
const CANOPY_HEIGHT = 4.5
const CANOPY_OVERHANG = 1.5

// Furniture
const BENCH_COUNT = 6
const LIGHT_COUNT = 8
const SIGN_COUNT = 3

/**
 * A train station platform placed alongside the track.
 * Long enough that the train takes noticeable time to pass through.
 */
export class Station {
  readonly group = new THREE.Group()
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = []

  constructor(name: string, zCenter: number) {
    this.group.position.z = zCenter

    const concreteMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x9a9590, roughness: 0.85, metalness: 0.05 })
    )
    const edgeMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xddcc44, roughness: 0.6, metalness: 0.1 })
    )
    const roofMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.7, metalness: 0.3 })
    )
    const pillarMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x5a6472, roughness: 0.6, metalness: 0.4 })
    )
    const benchWoodMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 0.8, metalness: 0 })
    )
    const benchMetalMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.4, metalness: 0.7 })
    )
    const signMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x1a2a4a, roughness: 0.5, metalness: 0.2 })
    )
    const signTextMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xffdd66, roughness: 0.3, metalness: 0.1, emissive: 0xffdd66, emissiveIntensity: 0.3 })
    )
    const lightMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.4, metalness: 0.6 })
    )
    const lightBulbMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xffffdd, emissive: 0xffffdd, emissiveIntensity: 0.8, roughness: 0.2 })
    )

    this.buildPlatform(concreteMat, edgeMat)
    this.buildCanopy(roofMat, pillarMat)
    this.buildBenches(benchWoodMat, benchMetalMat)
    this.buildLights(lightMat, lightBulbMat)
    this.buildSigns(name, signMat, signTextMat)
  }

  /** Platform surface + safety edge line */
  private buildPlatform(mat: THREE.Material, edgeMat: THREE.Material) {
    // Main platform slab
    const platform = new THREE.Mesh(
      this.box(PLATFORM_WIDTH, PLATFORM_HEIGHT, PLATFORM_LENGTH), mat
    )
    platform.position.set(PLATFORM_X, PLATFORM_HEIGHT / 2, 0)
    platform.receiveShadow = true
    this.group.add(platform)

    // Yellow safety line along the platform edge
    const edge = new THREE.Mesh(
      this.box(EDGE_LINE_W, 0.02, PLATFORM_LENGTH), edgeMat
    )
    edge.position.set(PLATFORM_X - PLATFORM_WIDTH / 2 + 0.5, PLATFORM_HEIGHT + 0.01, 0)
    this.group.add(edge)

    // Platform edge face (vertical drop to track level)
    const face = new THREE.Mesh(
      this.box(0.15, PLATFORM_HEIGHT, PLATFORM_LENGTH), mat
    )
    face.position.set(PLATFORM_X - PLATFORM_WIDTH / 2, PLATFORM_HEIGHT / 2, 0)
    this.group.add(face)
  }

  /** Roof canopy over the middle section */
  private buildCanopy(roofMat: THREE.Material, pillarMat: THREE.Material) {
    // Roof slab
    const roof = new THREE.Mesh(
      this.box(PLATFORM_WIDTH + CANOPY_OVERHANG * 2, 0.15, CANOPY_LENGTH), roofMat
    )
    roof.position.set(PLATFORM_X, CANOPY_HEIGHT, 0)
    roof.castShadow = true
    this.group.add(roof)

    // Support pillars
    const pillarSpacing = 30
    const pillarCount = Math.floor(CANOPY_LENGTH / pillarSpacing)
    for (let i = 0; i < pillarCount; i++) {
      const pillar = new THREE.Mesh(this.box(0.25, CANOPY_HEIGHT, 0.25), pillarMat)
      pillar.position.set(
        PLATFORM_X + PLATFORM_WIDTH / 2 - 0.5,
        CANOPY_HEIGHT / 2,
        -CANOPY_LENGTH / 2 + i * pillarSpacing + pillarSpacing / 2
      )
      pillar.castShadow = true
      this.group.add(pillar)
    }
  }

  /** Wooden benches on the platform */
  private buildBenches(woodMat: THREE.Material, metalMat: THREE.Material) {
    const spacing = PLATFORM_LENGTH / (BENCH_COUNT + 1)
    for (let i = 0; i < BENCH_COUNT; i++) {
      const bench = new THREE.Group()

      // Seat
      const seat = new THREE.Mesh(this.box(0.5, 0.06, 2.0), woodMat)
      seat.position.y = 0.45
      bench.add(seat)

      // Backrest
      const back = new THREE.Mesh(this.box(0.06, 0.5, 2.0), woodMat)
      back.position.set(0.22, 0.7, 0)
      bench.add(back)

      // Legs
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(this.box(0.4, 0.45, 0.08), metalMat)
        leg.position.set(0, 0.225, side * 0.85)
        bench.add(leg)
      }

      bench.position.set(
        PLATFORM_X + PLATFORM_WIDTH / 2 - 1.2,
        PLATFORM_HEIGHT,
        -PLATFORM_LENGTH / 2 + (i + 1) * spacing
      )
      bench.rotation.y = Math.PI // face the track
      this.group.add(bench)
    }
  }

  /** Platform light posts */
  private buildLights(poleMat: THREE.Material, bulbMat: THREE.Material) {
    const spacing = PLATFORM_LENGTH / (LIGHT_COUNT + 1)
    for (let i = 0; i < LIGHT_COUNT; i++) {
      // Pole
      const pole = new THREE.Mesh(this.box(0.12, 3.8, 0.12), poleMat)
      pole.position.set(
        PLATFORM_X - PLATFORM_WIDTH / 2 + 0.8,
        PLATFORM_HEIGHT + 1.9,
        -PLATFORM_LENGTH / 2 + (i + 1) * spacing
      )
      this.group.add(pole)

      // Light fixture (arm + bulb)
      const arm = new THREE.Mesh(this.box(0.8, 0.06, 0.06), poleMat)
      arm.position.set(
        PLATFORM_X - PLATFORM_WIDTH / 2 + 0.8 - 0.35,
        PLATFORM_HEIGHT + 3.8,
        -PLATFORM_LENGTH / 2 + (i + 1) * spacing
      )
      this.group.add(arm)

      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 6), bulbMat
      )
      bulb.position.set(
        PLATFORM_X - PLATFORM_WIDTH / 2 + 0.8 - 0.7,
        PLATFORM_HEIGHT + 3.75,
        -PLATFORM_LENGTH / 2 + (i + 1) * spacing
      )
      this.group.add(bulb)
    }
  }

  /** Station name signs hanging from the canopy */
  private buildSigns(_name: string, signMat: THREE.Material, textMat: THREE.Material) {
    const spacing = CANOPY_LENGTH / (SIGN_COUNT + 1)
    for (let i = 0; i < SIGN_COUNT; i++) {
      const sign = new THREE.Group()

      // Sign board
      const board = new THREE.Mesh(this.box(0.08, 0.6, 3.5), signMat)
      sign.add(board)

      // Text strip (emissive bar representing station name)
      const textBar = new THREE.Mesh(this.box(0.09, 0.35, 2.8), textMat)
      textBar.position.x = -0.01
      sign.add(textBar)

      // Hanging rods
      for (const side of [-1, 1]) {
        const rod = new THREE.Mesh(this.box(0.03, 0.5, 0.03), signMat)
        rod.position.set(0, 0.55, side * 1.2)
        sign.add(rod)
      }

      sign.position.set(
        PLATFORM_X,
        CANOPY_HEIGHT - 0.8,
        -CANOPY_LENGTH / 2 + (i + 1) * spacing
      )
      this.group.add(sign)
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
    for (const r of this.disposables) r.dispose()
    this.disposables = []
  }
}

/**
 * Manages a single dynamically-placed station.
 * The parent calls showStation() when the train approaches, hideStation() after departure.
 */
export class StationManager {
  readonly group = new THREE.Group()
  private current: Station | null = null

  static readonly PLATFORM_LENGTH = PLATFORM_LENGTH

  /** Show a station at the given Z center. Replaces any existing station. */
  showStation(name: string, zCenter: number) {
    this.hideStation()
    this.current = new Station(name, zCenter)
    this.group.add(this.current.group)
  }

  /** Remove the current station. */
  hideStation() {
    if (this.current) {
      this.group.remove(this.current.group)
      this.current.dispose()
      this.current = null
    }
  }

  dispose() {
    this.hideStation()
  }
}
