import * as THREE from 'three'
import { trackElevationAt, trackGradeAt } from '../terrain/RouteProfile'
import { roadCenterX } from '../terrain/TerrainGen'

// Platform dimensions — long enough to feel like a real station
const PLATFORM_LENGTH = 180
const PLATFORM_WIDTH = 8
const PLATFORM_HEIGHT = 1.1
const PLATFORM_X = 6 // center of platform from track center
const EDGE_LINE_W = 0.35

// Canopy
const CANOPY_LENGTH = 132
const CANOPY_HEIGHT = 4.5
const CANOPY_OVERHANG = 1.5

// Furniture
const BENCH_COUNT = 6
const LIGHT_COUNT = 7
const SIGN_COUNT = 2

/**
 * A train station platform placed alongside the track.
 * Long enough that the train takes noticeable time to pass through.
 */
export class Station {
  readonly group = new THREE.Group()
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = []

  constructor(name: string, zCenter: number) {
    this.group.position.set(0, trackElevationAt(zCenter), zCenter)
    this.group.rotation.x = -Math.atan(trackGradeAt(zCenter))

    const concreteMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: this.makePlatformTexture(),
        roughness: 0.9,
        metalness: 0.03,
      })
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
    const asphaltMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x4b4d4e, roughness: 0.95 })
    )
    const facadeMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xc9baa0, roughness: 0.88 })
    )
    const facadeTrimMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x766b5c, roughness: 0.78 })
    )
    const facadeGlassMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0x344a5c, roughness: 0.25, metalness: 0.35,
        emissive: 0xffd68a, emissiveIntensity: 0.18,
      })
    )

    this.buildPlatform(concreteMat, edgeMat)
    this.buildCanopy(roofMat, pillarMat)
    this.buildBenches(benchWoodMat, benchMetalMat)
    this.buildLights(lightMat, lightBulbMat)
    this.buildSigns(name, signMat, signTextMat)
    this.buildDistrict(
      name,
      roadCenterX(zCenter),
      asphaltMat,
      facadeMat,
      facadeTrimMat,
      facadeGlassMat,
      lightMat,
      lightBulbMat,
    )
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

  /** The station frontage is intentionally separate from the platform: it reads as a place, not a prop beside the rails. */
  private buildDistrict(
    name: string,
    roadX: number,
    asphaltMat: THREE.Material,
    facadeMat: THREE.Material,
    trimMat: THREE.Material,
    glassMat: THREE.Material,
    lightMat: THREE.Material,
    bulbMat: THREE.Material,
  ) {
    const pavingMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xb9b1a4, roughness: 0.9 })
    )
    const curbMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xd7d2c8, roughness: 0.82 })
    )
    const roofMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x555b61, roughness: 0.76, metalness: 0.16 })
    )

    const road = new THREE.Mesh(this.box(7.2, 0.08, PLATFORM_LENGTH + 96), asphaltMat)
    road.position.set(roadX, 0.05, 0)
    road.receiveShadow = true
    this.group.add(road)

    for (const side of [-1, 1]) {
      const curb = new THREE.Mesh(this.box(0.22, 0.16, PLATFORM_LENGTH + 96), curbMat)
      curb.position.set(roadX + side * 3.7, 0.1, 0)
      this.group.add(curb)
    }

    const forecourt = new THREE.Mesh(this.box(17, 0.09, 38), pavingMat)
    forecourt.position.set(roadX + 0.5, 0.07, 0)
    forecourt.receiveShadow = true
    this.group.add(forecourt)

    for (const z of [-112, 112]) {
      const crossing = new THREE.Mesh(this.box(13, 0.1, 5.6), pavingMat)
      crossing.position.set(roadX - 5.5, 0.08, z)
      this.group.add(crossing)
    }

    const hall = new THREE.Group()
    const hallBody = new THREE.Mesh(this.box(10.5, 4.6, 20), facadeMat)
    hallBody.position.y = 2.3
    hallBody.castShadow = true
    hall.add(hallBody)

    for (const side of [-1, 1]) {
      const roof = new THREE.Mesh(this.box(5.9, 0.2, 20.7), roofMat)
      roof.position.set(side * 2.7, 5.05, 0)
      roof.rotation.z = -side * 0.42
      roof.castShadow = true
      hall.add(roof)
    }

    const entranceCanopy = new THREE.Mesh(this.box(0.9, 0.14, 11), trimMat)
    entranceCanopy.position.set(-5.45, 3.45, 0)
    hall.add(entranceCanopy)

    const door = new THREE.Mesh(this.box(0.09, 2.25, 2.5), glassMat)
    door.position.set(-5.3, 1.15, 0)
    hall.add(door)

    for (const z of [-6.2, -3.3, 3.3, 6.2]) {
      const window = new THREE.Mesh(this.box(0.08, 1.55, 1.9), glassMat)
      window.position.set(-5.31, 2.15, z)
      hall.add(window)
    }

    const sign = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(6.4, 0.86)),
      this.track(new THREE.MeshBasicMaterial({ map: this.makeStationNameTexture(name) }))
    )
    sign.position.set(-5.36, 4.25, 0)
    sign.rotation.y = -Math.PI / 2
    hall.add(sign)

    hall.position.set(roadX + 8, 0, 0)
    this.group.add(hall)

    this.addStreetBuilding(roadX + 16, -78, 8.5, 12, 4.1, facadeMat, roofMat, glassMat)
    this.addStreetBuilding(roadX + 16, 74, 7.2, 10, 3.5, trimMat, roofMat, glassMat)
    this.addStreetBuilding(roadX + 10, 126, 9.5, 13, 4.5, facadeMat, roofMat, glassMat)
    this.addStreetBuilding(roadX + 11, -128, 8, 11, 3.8, trimMat, roofMat, glassMat)

    const shelter = new THREE.Group()
    const shelterRoof = new THREE.Mesh(this.box(3.5, 0.16, 6.2), roofMat)
    shelterRoof.position.set(0, 2.9, 0)
    shelter.add(shelterRoof)
    const shelterBack = new THREE.Mesh(this.box(0.08, 2.6, 5.4), glassMat)
    shelterBack.position.set(1.7, 1.45, 0)
    shelter.add(shelterBack)
    for (const z of [-2.6, 2.6]) {
      const post = new THREE.Mesh(this.box(0.12, 2.9, 0.12), lightMat)
      post.position.set(-1.55, 1.45, z)
      shelter.add(post)
    }
    shelter.position.set(roadX - 3.9, 0.02, 20)
    this.group.add(shelter)

    const bayMat = this.track(new THREE.MeshStandardMaterial({ color: 0xdad6ce, roughness: 0.72 }))
    for (const z of [-13, 0, 13]) {
      const divider = new THREE.Mesh(this.box(0.08, 0.015, 8.2), bayMat)
      divider.position.set(roadX - 5.1, 0.14, z)
      this.group.add(divider)
    }
    this.addParkedCar(roadX - 5.5, -6.5, 0x536f82, glassMat)
    this.addParkedCar(roadX - 5.5, 6.5, 0x83907d, glassMat)

    for (const z of [-190, -142, -94, -46, 46, 94, 142, 190]) {
      const pole = new THREE.Mesh(this.box(0.13, 4.2, 0.13), lightMat)
      pole.position.set(roadX - 4.6, 2.1, z)
      this.group.add(pole)
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), bulbMat)
      bulb.position.set(roadX - 4.6, 4.2, z)
      this.group.add(bulb)
    }
  }

  /** Parked cars give the forecourt an arrival function without crowding the platform. */
  private addParkedCar(x: number, z: number, color: number, glassMat: THREE.Material) {
    const bodyMat = this.track(new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.18 }))
    const car = new THREE.Group()
    const body = new THREE.Mesh(this.box(1.9, 0.48, 3.7), bodyMat)
    body.position.y = 0.38
    body.castShadow = true
    car.add(body)
    const cabin = new THREE.Mesh(this.box(1.42, 0.42, 1.8), glassMat)
    cabin.position.set(0, 0.78, -0.16)
    car.add(cabin)
    for (const side of [-1, 1]) {
      for (const front of [-1, 1]) {
        const wheel = new THREE.Mesh(
          this.track(new THREE.CylinderGeometry(0.22, 0.22, 0.13, 10)),
          this.track(new THREE.MeshStandardMaterial({ color: 0x202326, roughness: 0.88 })),
        )
        wheel.rotation.z = Math.PI / 2
        wheel.position.set(side * 0.87, 0.23, front * 1.18)
        car.add(wheel)
      }
    }
    car.position.set(x, 0, z)
    this.group.add(car)
  }

  private addStreetBuilding(
    x: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    wallMat: THREE.Material,
    roofMat: THREE.Material,
    glassMat: THREE.Material,
  ) {
    const building = new THREE.Group()
    const body = new THREE.Mesh(this.box(width, height, depth), wallMat)
    body.position.y = height / 2
    body.castShadow = true
    building.add(body)

    const roof = new THREE.Mesh(this.box(width + 0.5, 0.24, depth + 0.5), roofMat)
    roof.position.y = height + 0.12
    roof.castShadow = true
    building.add(roof)

    const door = new THREE.Mesh(this.box(0.08, 2.05, 1.6), glassMat)
    door.position.set(-width / 2 - 0.05, 1.04, 0)
    building.add(door)

    for (const offset of [-depth * 0.27, depth * 0.27]) {
      const window = new THREE.Mesh(this.box(0.08, 1.25, 1.45), glassMat)
      window.position.set(-width / 2 - 0.05, height * 0.62, offset)
      building.add(window)
    }

    building.position.set(x, 0, z)
    this.group.add(building)
  }

  private makeStationNameTexture(name: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 86
    const context = canvas.getContext('2d')
    if (context) {
      context.fillStyle = '#17344e'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = '#e8d99e'
      context.font = '700 50px sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(name, canvas.width / 2, canvas.height / 2 + 2)
    }
    const texture = this.track(new THREE.CanvasTexture(canvas))
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }

  private makePlatformTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = 160
    canvas.height = 160
    const context = canvas.getContext('2d')!
    context.fillStyle = '#a9a7a0'
    context.fillRect(0, 0, canvas.width, canvas.height)

    context.strokeStyle = 'rgba(64, 64, 58, 0.26)'
    context.lineWidth = 1
    for (let y = 0; y <= canvas.height; y += 32) {
      context.beginPath()
      context.moveTo(0, y)
      context.lineTo(canvas.width, y)
      context.stroke()
    }
    for (let x = 0; x <= canvas.width; x += 40) {
      context.beginPath()
      context.moveTo(x, 0)
      context.lineTo(x, canvas.height)
      context.stroke()
    }

    for (let i = 0; i < 720; i++) {
      const x = (i * 47.71) % canvas.width
      const y = (i * 91.37) % canvas.height
      const shade = 104 + (i * 37) % 45
      context.fillStyle = `rgba(${shade}, ${shade}, ${shade - 4}, 0.18)`
      context.fillRect(x, y, 1.2, 1.2)
    }

    const texture = this.track(new THREE.CanvasTexture(canvas))
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(PLATFORM_WIDTH / 2, PLATFORM_LENGTH / 7.5)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }

  private box(w: number, h: number, d: number): THREE.BoxGeometry {
    return this.track(new THREE.BoxGeometry(w, h, d))
  }

  private track<T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(resource: T): T {
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
 * Auto-hides the station once it has fully left the camera's view, with a short grace period.
 */
export class StationManager {
  readonly group = new THREE.Group()
  private current: Station | null = null
  private currentZ = 0
  private hideTimer = 0

  static readonly PLATFORM_LENGTH = PLATFORM_LENGTH
  /** Place the station building just ahead of the final side-window sightline. */
  static readonly APPROACH_STATION_LEAD = 18
  /** Extra distance past the platform edge before hiding (units). */
  private static readonly HIDE_BUFFER = 60
  /** Grace period after the station leaves view before hiding (seconds). */
  private static readonly HIDE_DELAY = 0.8

  /** Show a station at the given Z center. Replaces any existing station. */
  showStation(name: string, zCenter: number) {
    this.hideStation()
    this.current = new Station(name, zCenter)
    this.currentZ = zCenter
    this.hideTimer = 0
    this.group.add(this.current.group)
  }

  /** Remove the current station immediately. */
  hideStation() {
    if (this.current) {
      this.group.remove(this.current.group)
      this.current.dispose()
      this.current = null
    }
    this.hideTimer = 0
  }

  /**
   * Call every frame with the camera Z position.
   * Automatically hides the station once it has fully left the view,
   * after a short grace period so the transition is not jarring.
   */
  update(camZ: number, dt: number) {
    if (!this.current) return
    const hideThreshold = this.currentZ + StationManager.PLATFORM_LENGTH / 2 + StationManager.HIDE_BUFFER
    if (camZ > hideThreshold) {
      this.hideTimer += dt
      if (this.hideTimer >= StationManager.HIDE_DELAY) {
        this.hideStation()
      }
    } else {
      this.hideTimer = 0
    }
  }

  dispose() {
    this.hideStation()
  }
}
