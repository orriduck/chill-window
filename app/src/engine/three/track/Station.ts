import * as THREE from 'three'
import { trackElevationAt, trackGradeAt } from '../terrain/RouteProfile'
import { roadCenterX } from '../terrain/TerrainGen'
import {
  DEFAULT_ROUTE_PLAN,
  routeBeatForSegment,
  ROUTE_SEGMENT_LENGTH,
  type RoutePlan,
  type StationKind,
} from '../terrain/RouteFeatures'

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
const PLATFORM_SIGN_Y = CANOPY_HEIGHT - 0.8
const PLATFORM_SIGN_HEIGHT = 0.6

// Furniture
const BENCH_COUNT = 6
const LIGHT_COUNT = 7
// The first board is centered at the scheduled stop, with the second held
// toward departure so both states read without overfilling the platform.
const PLATFORM_SIGN_OFFSETS = [-16, 22]

const DISTRICT_ROAD_WIDTH = 7.2
const DISTRICT_ROAD_HALF_WIDTH = DISTRICT_ROAD_WIDTH / 2
const DISTRICT_FORECOURT_GAP = 0.35
const DISTRICT_HALL_FRONT_GAP = 1
const STATION_HALL_WIDTH = 10.5
const STATION_HALL_HEIGHT = 4.6
const STATION_HALL_LENGTH = 20
const STATION_FACADE_X = -STATION_HALL_WIDTH / 2
const STATION_ENTRANCE_WIDTH = 4.6
const STATION_WINDOW_CENTERS = [-7.25, -4.1, 4.1, 7.25] as const
const URBAN_PASSING_TRACK_CENTERS = [-4.4, -7.5] as const
const URBAN_TURNOUT_LEAD = 36

export function urbanPassingTrackCenters(): readonly number[] {
  return URBAN_PASSING_TRACK_CENTERS
}

/** Heading of the centreline through an urban turnout. Both rails and their
 * sleepers use this shared geometry so the diverging track reads as one unit. */
export function urbanTurnoutAlignmentAngle(passingCenterX: number, longitudinalDistance: number): number {
  return Math.atan2(passingCenterX, longitudinalDistance)
}

export type StationVisualKind = Exclude<StationKind, 'none'>

type StationProfile = {
  scaleX: number
  scaleZ: number
  district: 'full' | 'rural'
  passingTracks: number
  footbridge: boolean
}

const STATION_PROFILES: Record<StationVisualKind, StationProfile> = {
  'rural-halt': { scaleX: 0.78, scaleZ: 0.52, district: 'rural', passingTracks: 0, footbridge: false },
  regional: { scaleX: 1, scaleZ: 1, district: 'full', passingTracks: 0, footbridge: false },
  'urban-through': { scaleX: 1.08, scaleZ: 1.28, district: 'full', passingTracks: 2, footbridge: true },
}

/** Station stops inherit their visible typology from the current route beat.
 * Open country still receives a small halt at the origin or an unscheduled stop. */
export function stationVisualKindAt(z: number, plan?: RoutePlan): StationVisualKind {
  const beat = routeBeatForSegment(Math.floor(z / ROUTE_SEGMENT_LENGTH), plan)
  return beat.station === 'none' ? 'rural-halt' : beat.station
}

export type StationDistrictLayout = {
  roadMinX: number
  roadMaxX: number
  forecourtCenterX: number
  forecourtWidth: number
  hallCenterX: number
  taxiBayX: number
  shelterX: number
}

export type StationHallFacadeLayout = {
  frontX: number
  porticoX: number
  stepX: number
  eaveY: number
  ridgeY: number
  entranceWidth: number
  windowCenters: readonly number[]
}

/**
 * Keep the station's access layers physically adjacent instead of overlapping:
 * rail platform, pedestrian forecourt/taxi bay, parallel road, then the hall.
 */
export function stationDistrictLayout(roadX: number): StationDistrictLayout {
  const platformOuterX = PLATFORM_X + PLATFORM_WIDTH / 2
  const forecourtMinX = platformOuterX + 0.6
  const roadMinX = roadX - DISTRICT_ROAD_HALF_WIDTH
  const forecourtMaxX = roadMinX - DISTRICT_FORECOURT_GAP
  const forecourtWidth = forecourtMaxX - forecourtMinX
  const hallMinX = roadX + DISTRICT_ROAD_HALF_WIDTH + DISTRICT_HALL_FRONT_GAP

  return {
    roadMinX,
    roadMaxX: roadX + DISTRICT_ROAD_HALF_WIDTH,
    forecourtCenterX: (forecourtMinX + forecourtMaxX) / 2,
    forecourtWidth,
    hallCenterX: hallMinX + STATION_HALL_WIDTH / 2,
    taxiBayX: forecourtMinX + 2.25,
    shelterX: forecourtMaxX - 1.15,
  }
}

/** The public face of the hall is constrained as architecture, not a set of
 * props: entrance and steps sit in front of the facade, with windows clear of
 * the central circulation bay and the roof ending above the wall. */
export function stationHallFacadeLayout(): StationHallFacadeLayout {
  return {
    frontX: STATION_FACADE_X,
    porticoX: STATION_FACADE_X - 0.72,
    stepX: STATION_FACADE_X - 1.1,
    eaveY: STATION_HALL_HEIGHT + 0.12,
    ridgeY: STATION_HALL_HEIGHT + 1.78,
    entranceWidth: STATION_ENTRANCE_WIDTH,
    windowCenters: STATION_WINDOW_CENTERS,
  }
}

/**
 * Fade station lighting against the real exterior ambient budget. This keeps
 * daytime fixtures quiet while allowing a warm, low-glare platform read at
 * dusk, night, and inside a tunnel approach.
 */
export function stationNightLightLevel(ambientIntensity: number): number {
  const darkness = THREE.MathUtils.clamp((0.42 - ambientIntensity) / 0.24, 0, 1)
  return 0.12 + THREE.MathUtils.smoothstep(darkness, 0, 1) * 0.88
}

/**
 * A train station platform placed alongside the track.
 * Long enough that the train takes noticeable time to pass through.
 */
export class Station {
  readonly group = new THREE.Group()
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = []
  private nightLitMaterials: { material: THREE.MeshStandardMaterial; baseIntensity: number }[] = []
  private platformGlowMaterial: THREE.MeshBasicMaterial | null = null
  readonly kind: StationVisualKind
  private readonly profile: StationProfile

  constructor(name: string, zCenter: number, kind = stationVisualKindAt(zCenter)) {
    this.kind = kind
    this.profile = STATION_PROFILES[kind]
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
    const lightMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.4, metalness: 0.6 })
    )
    const lightBulbMat = this.registerNightMaterial(
      this.track(
        new THREE.MeshStandardMaterial({ color: 0xffe1b0, emissive: 0xffc574, emissiveIntensity: 0, roughness: 0.2 })
      ),
      1.1,
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
    const facadeGlassMat = this.registerNightMaterial(
      this.track(
        new THREE.MeshStandardMaterial({
          color: 0x344a5c, roughness: 0.25, metalness: 0.35,
          emissive: 0xffd08a, emissiveIntensity: 0,
        })
      ),
      0.32,
    )
    const platformGlowMaterial = this.track(
      new THREE.MeshBasicMaterial({
        color: 0xffc77d,
        map: this.makePlatformGlowTexture(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    )
    this.platformGlowMaterial = platformGlowMaterial
    const bulbGeometry = this.track(new THREE.SphereGeometry(0.12, 8, 6))
    const roadBulbGeometry = this.track(new THREE.SphereGeometry(0.16, 10, 8))
    const platformGlowGeometry = this.track(new THREE.PlaneGeometry(5.4, 8.2))

    this.buildPlatform(concreteMat, edgeMat)
    this.buildCanopy(roofMat, pillarMat)
    this.buildBenches(benchWoodMat, benchMetalMat)
    this.buildLights(lightMat, lightBulbMat, platformGlowMaterial, bulbGeometry, platformGlowGeometry)
    this.buildSigns(name, signMat)
    if (this.profile.district === 'full') {
      this.buildDistrict(
        name,
        roadCenterX(zCenter),
        asphaltMat,
        facadeMat,
        facadeTrimMat,
        facadeGlassMat,
        lightMat,
        lightBulbMat,
        roadBulbGeometry,
      )
    } else {
      this.buildRuralHaltDistrict(asphaltMat, facadeMat, facadeGlassMat, lightMat)
    }
    if (this.profile.passingTracks > 0) this.buildUrbanPassingTracks(roofMat, pillarMat)
    if (this.profile.footbridge) this.buildUrbanFootbridge(pillarMat)
    this.group.scale.set(this.profile.scaleX, 1, this.profile.scaleZ)
    this.updateLighting(0.45)
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
  private buildLights(
    poleMat: THREE.Material,
    bulbMat: THREE.Material,
    glowMat: THREE.Material,
    bulbGeometry: THREE.BufferGeometry,
    glowGeometry: THREE.BufferGeometry,
  ) {
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
        bulbGeometry, bulbMat
      )
      bulb.position.set(
        PLATFORM_X - PLATFORM_WIDTH / 2 + 0.8 - 0.7,
        PLATFORM_HEIGHT + 3.75,
        -PLATFORM_LENGTH / 2 + (i + 1) * spacing
      )
      this.group.add(bulb)

      // A translucent pool conveys a lit platform without seven costly point
      // lights. It stays on the platform surface and is occluded by furniture.
      const pool = new THREE.Mesh(glowGeometry, glowMat)
      pool.rotation.x = -Math.PI / 2
      pool.position.set(PLATFORM_X + 0.5, PLATFORM_HEIGHT + 0.018, bulb.position.z)
      this.group.add(pool)
    }
  }

  /** Station-specific platform and section signs hanging from the canopy. */
  private buildSigns(name: string, signMat: THREE.Material) {
    const displayMat = this.track(new THREE.MeshBasicMaterial({ map: this.makePlatformSignTexture(name) }))
    const rodLength = CANOPY_HEIGHT - (PLATFORM_SIGN_Y + PLATFORM_SIGN_HEIGHT / 2)
    for (const zOffset of PLATFORM_SIGN_OFFSETS) {
      const sign = new THREE.Group()

      // Sign board
      const board = new THREE.Mesh(this.box(0.08, PLATFORM_SIGN_HEIGHT, 3.5), signMat)
      sign.add(board)

      // Two physical faces let travellers read the same location data from
      // the train and the platform without turning off depth testing.
      for (const side of [-1, 1]) {
        const display = new THREE.Mesh(this.track(new THREE.PlaneGeometry(2.8, 0.35)), displayMat)
        display.rotation.y = side * Math.PI / 2
        display.position.x = side * 0.051
        sign.add(display)
      }

      // Hanging rods
      for (const side of [-1, 1]) {
        const rod = new THREE.Mesh(this.box(0.03, rodLength, 0.03), signMat)
        rod.position.set(0, PLATFORM_SIGN_HEIGHT / 2 + rodLength / 2, side * 1.2)
        sign.add(rod)
      }

      sign.position.set(
        PLATFORM_X,
        PLATFORM_SIGN_Y,
        zOffset,
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
    roadBulbGeometry: THREE.BufferGeometry,
  ) {
    const layout = stationDistrictLayout(roadX)
    const pavingMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xb9b1a4, roughness: 0.9 })
    )
    const curbMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xd7d2c8, roughness: 0.82 })
    )
    const roofMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x555b61, roughness: 0.76, metalness: 0.16 })
    )
    const markingMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xe7dfc9, roughness: 0.74 })
    )
    const planterMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x6a6255, roughness: 0.86 })
    )
    const shrubMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x53664a, roughness: 0.94 })
    )
    const facadeInsetMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x313c42, roughness: 0.82, metalness: 0.08 })
    )
    const facadeMetalMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x4d5960, roughness: 0.38, metalness: 0.7 })
    )
    const clockFaceMat = this.track(
      new THREE.MeshBasicMaterial({ color: 0xe9e5d7 })
    )

    const road = new THREE.Mesh(this.box(DISTRICT_ROAD_WIDTH, 0.08, PLATFORM_LENGTH + 96), asphaltMat)
    road.position.set(roadX, 0.05, 0)
    road.receiveShadow = true
    this.group.add(road)

    for (const side of [-1, 1]) {
      const curb = new THREE.Mesh(this.box(0.22, 0.16, PLATFORM_LENGTH + 96), curbMat)
      curb.position.set(roadX + side * (DISTRICT_ROAD_HALF_WIDTH + 0.1), 0.1, 0)
      this.group.add(curb)
    }

    const forecourt = new THREE.Mesh(this.box(layout.forecourtWidth, 0.09, 44), pavingMat)
    forecourt.position.set(layout.forecourtCenterX, 0.07, 0)
    forecourt.receiveShadow = true
    this.group.add(forecourt)

    // The central dashes and crosswalk make the parallel road read as a real
    // access route while the taxi bay stays on the platform side of its curb.
    for (let z = -124; z <= 124; z += 16) {
      const dash = new THREE.Mesh(this.box(0.12, 0.018, 5.6), markingMat)
      dash.position.set(roadX, 0.101, z)
      this.group.add(dash)
    }
    for (const xOffset of [-2.45, -1.15, 0.15, 1.45]) {
      const stripe = new THREE.Mesh(this.box(0.82, 0.022, 5.1), markingMat)
      stripe.position.set(roadX + xOffset, 0.105, -13)
      this.group.add(stripe)
    }

    for (const z of [-112, 112]) {
      const crossing = new THREE.Mesh(this.box(13, 0.1, 5.6), pavingMat)
      crossing.position.set(roadX - 5.5, 0.08, z)
      this.group.add(crossing)
    }

    const facadeLayout = stationHallFacadeLayout()
    const hall = new THREE.Group()
    const hallPlinth = new THREE.Mesh(this.box(STATION_HALL_WIDTH + 0.35, 0.5, STATION_HALL_LENGTH + 0.45), trimMat)
    hallPlinth.position.y = 0.25
    hallPlinth.castShadow = true
    hall.add(hallPlinth)

    const hallBody = new THREE.Mesh(this.box(STATION_HALL_WIDTH, STATION_HALL_HEIGHT, STATION_HALL_LENGTH), facadeMat)
    hallBody.position.y = STATION_HALL_HEIGHT / 2
    hallBody.castShadow = true
    hall.add(hallBody)

    for (const side of [-1, 1]) {
      const roof = new THREE.Mesh(this.box(5.82, 0.2, STATION_HALL_LENGTH + 0.7), roofMat)
      roof.position.set(side * 2.72, 5.46, 0)
      roof.rotation.z = -side * 0.3
      roof.castShadow = true
      hall.add(roof)
    }

    const ridge = new THREE.Mesh(this.box(0.28, 0.16, STATION_HALL_LENGTH + 0.9), facadeMetalMat)
    ridge.position.set(0, facadeLayout.ridgeY, 0)
    hall.add(ridge)
    for (const side of [-1, 1]) {
      const eave = new THREE.Mesh(this.box(0.34, 0.18, STATION_HALL_LENGTH + 0.9), facadeMetalMat)
      eave.position.set(side * (STATION_HALL_WIDTH / 2 + 0.04), facadeLayout.eaveY, 0)
      hall.add(eave)
    }
    for (const z of [-8.8, 8.8]) {
      const downpipe = new THREE.Mesh(this.box(0.12, 4.15, 0.12), facadeMetalMat)
      downpipe.position.set(facadeLayout.frontX - 0.15, 2.12, z)
      hall.add(downpipe)
    }

    const fascia = new THREE.Mesh(this.box(0.15, 0.12, STATION_HALL_LENGTH + 0.24), trimMat)
    fascia.position.set(facadeLayout.frontX - 0.09, 3.55, 0)
    hall.add(fascia)
    for (const z of facadeLayout.windowCenters) {
      this.addHallWindow(hall, facadeLayout, z, trimMat, facadeInsetMat, glassMat)
    }
    this.addHallEntrance(hall, facadeLayout, trimMat, facadeInsetMat, facadeMetalMat, glassMat)
    this.addHallClock(hall, facadeLayout, facadeMetalMat, clockFaceMat)

    const signBacking = new THREE.Mesh(this.box(0.13, 1.04, 5.25), facadeInsetMat)
    signBacking.position.set(facadeLayout.frontX - 0.08, 4.18, 0)
    hall.add(signBacking)
    const sign = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(6.4, 0.86)),
      this.track(new THREE.MeshBasicMaterial({ map: this.makeStationNameTexture(name) }))
    )
    sign.position.set(facadeLayout.frontX - 0.155, 4.18, 0)
    sign.rotation.y = -Math.PI / 2
    hall.add(sign)

    hall.position.set(layout.hallCenterX, 0, 0)
    this.group.add(hall)

    this.addStreetBuilding(roadX + 17, -34, 7.6, 11, 3.7, trimMat, roofMat, glassMat)
    this.addStreetBuilding(roadX + 18, 34, 8.2, 12, 4.1, facadeMat, roofMat, glassMat)
    this.addStreetBuilding(roadX + 18, -82, 8.5, 12, 4.1, facadeMat, roofMat, glassMat)
    this.addStreetBuilding(roadX + 18, 78, 7.2, 10, 3.5, trimMat, roofMat, glassMat)
    this.addStreetBuilding(roadX + 14, 128, 9.5, 13, 4.5, facadeMat, roofMat, glassMat)
    this.addStreetBuilding(roadX + 15, -130, 8, 11, 3.8, trimMat, roofMat, glassMat)

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
    shelter.position.set(layout.shelterX, 0.02, 18)
    this.group.add(shelter)

    for (const z of [-16, -8, 0, 8, 16]) {
      const divider = new THREE.Mesh(this.box(layout.forecourtWidth - 0.5, 0.018, 0.12), markingMat)
      divider.position.set(layout.forecourtCenterX, 0.14, z)
      this.group.add(divider)
    }
    this.addParkedCar(layout.taxiBayX, -6.5, 0x536f82, glassMat)
    this.addParkedCar(layout.taxiBayX, 6.5, 0x83907d, glassMat)

    for (const z of [-15, 15]) {
      const planter = new THREE.Mesh(this.box(1.05, 0.48, 2.4), planterMat)
      planter.position.set(layout.forecourtCenterX + 0.25, 0.24, z)
      planter.castShadow = true
      this.group.add(planter)
      const shrub = new THREE.Mesh(this.track(new THREE.DodecahedronGeometry(0.56, 0)), shrubMat)
      shrub.position.set(layout.forecourtCenterX + 0.25, 0.94, z)
      shrub.castShadow = true
      this.group.add(shrub)
    }

    for (const z of [-190, -142, -94, -46, 46, 94, 142, 190]) {
      const pole = new THREE.Mesh(this.box(0.13, 4.2, 0.13), lightMat)
      pole.position.set(layout.roadMinX - 0.75, 2.1, z)
      this.group.add(pole)
      const bulb = new THREE.Mesh(roadBulbGeometry, bulbMat)
      bulb.position.set(layout.roadMinX - 0.75, 4.2, z)
      this.group.add(bulb)
    }
  }

  /** A rural halt has access and waiting shelter, but no suburban station hall.
   * The compact layout intentionally reads as a village stop, not a scaled city. */
  private buildRuralHaltDistrict(
    asphaltMat: THREE.Material,
    wallMat: THREE.Material,
    glassMat: THREE.Material,
    metalMat: THREE.Material,
  ) {
    const roadX = roadCenterX(this.group.position.z)
    const road = new THREE.Mesh(this.box(3.8, 0.08, 112), asphaltMat)
    road.position.set(roadX, 0.05, 0)
    road.receiveShadow = true
    this.group.add(road)

    const gravelMat = this.track(new THREE.MeshStandardMaterial({ color: 0x8e887c, roughness: 0.98 }))
    const parking = new THREE.Mesh(this.box(5.6, 0.05, 16), gravelMat)
    parking.position.set(roadX - 4.6, 0.04, -12)
    parking.receiveShadow = true
    this.group.add(parking)

    const shelter = new THREE.Group()
    const roof = new THREE.Mesh(this.box(3.2, 0.14, 6.8), metalMat)
    roof.position.set(0, 2.6, 0)
    shelter.add(roof)
    const back = new THREE.Mesh(this.box(0.08, 2.3, 5.9), glassMat)
    back.position.set(1.55, 1.2, 0)
    shelter.add(back)
    for (const z of [-2.8, 2.8]) {
      const post = new THREE.Mesh(this.box(0.12, 2.6, 0.12), metalMat)
      post.position.set(-1.45, 1.3, z)
      shelter.add(post)
    }
    const bench = new THREE.Mesh(this.box(0.45, 0.42, 3.2), wallMat)
    bench.position.set(0.45, 0.52, 0)
    shelter.add(bench)
    shelter.position.set(PLATFORM_X + PLATFORM_WIDTH / 2 + 2.1, 0, 10)
    this.group.add(shelter)

    // Bicycle hoops are small but establish that the road is an arrival route.
    for (let i = 0; i < 4; i++) {
      const hoop = new THREE.Mesh(this.box(0.08, 0.72, 0.52), metalMat)
      hoop.position.set(roadX - 2.3, 0.36, 8 + i * 1.3)
      this.group.add(hoop)
    }
  }

  /** A through-station needs visible track capacity, not a larger copy of a hall. */
  private buildUrbanPassingTracks(railMat: THREE.Material, sleeperMat: THREE.Material) {
    const railLength = PLATFORM_LENGTH + 96
    const sleeperGeometry = this.track(new THREE.BoxGeometry(0.2, 0.12, 1.8))
    for (const centerX of URBAN_PASSING_TRACK_CENTERS.slice(0, this.profile.passingTracks)) {
      for (const railOffset of [-0.67, 0.67]) {
        const rail = new THREE.Mesh(this.box(0.08, 0.1, railLength), railMat)
        rail.position.set(centerX + railOffset, 0.1, 0)
        this.group.add(rail)
      }
      for (let z = -railLength / 2; z <= railLength / 2; z += 2.8) {
        const sleeper = new THREE.Mesh(sleeperGeometry, sleeperMat)
        sleeper.position.set(centerX, 0.02, z)
        this.group.add(sleeper)
      }
      this.buildUrbanTurnouts(centerX, railLength, railMat, sleeperMat)
    }
  }

  /** Connect every through line back to the main pair at both station ends.
   * This is deliberately compact but preserves the visible railway grammar:
   * diverging rail, reoriented sleepers, then a parallel passing track. */
  private buildUrbanTurnouts(
    passingCenterX: number,
    railLength: number,
    railMat: THREE.Material,
    sleeperMat: THREE.Material,
  ) {
    for (const direction of [-1, 1]) {
      const startZ = direction * (railLength / 2 - URBAN_TURNOUT_LEAD)
      const endZ = direction * (railLength / 2 + 2)
      for (const side of [-1, 1]) {
        const startX = side * 0.67
        const endX = passingCenterX + side * 0.67
        const dx = endX - startX
        const dz = endZ - startZ
        const length = Math.hypot(dx, dz)
        const rail = new THREE.Mesh(this.box(0.08, 0.1, length), railMat)
        rail.position.set((startX + endX) / 2, 0.1, (startZ + endZ) / 2)
        rail.rotation.y = Math.atan2(dx, dz)
        rail.castShadow = true
        this.group.add(rail)
      }

      const sleepers = 12
      for (let index = 1; index < sleepers; index++) {
        const t = index / sleepers
        const x = THREE.MathUtils.lerp(-0.67, passingCenterX, t)
        const z = THREE.MathUtils.lerp(startZ, endZ, t)
        const sleeper = new THREE.Mesh(this.box(2.35, 0.12, 0.28), sleeperMat)
        sleeper.position.set(x, 0.02, z)
        sleeper.rotation.y = urbanTurnoutAlignmentAngle(passingCenterX, endZ - startZ)
        this.group.add(sleeper)
      }
    }
  }

  /** A short pedestrian bridge makes the urban track bundle legible in profile. */
  private buildUrbanFootbridge(metalMat: THREE.Material) {
    const deckY = 5.4
    const bridgeZ = -38
    const deck = new THREE.Mesh(this.box(18, 0.18, 2.2), metalMat)
    deck.position.set(0, deckY, bridgeZ)
    deck.castShadow = true
    this.group.add(deck)
    for (const x of [-7.8, 7.8]) {
      const support = new THREE.Mesh(this.box(0.36, 5.3, 0.36), metalMat)
      support.position.set(x, 2.65, bridgeZ)
      support.castShadow = true
      this.group.add(support)
    }

    const guardMat = this.track(new THREE.MeshStandardMaterial({
      color: 0x65747a, roughness: 0.45, metalness: 0.66,
    }))
    for (const side of [-1, 1]) {
      const guard = new THREE.Mesh(this.box(18.2, 0.1, 0.1), guardMat)
      guard.position.set(0, deckY + 0.84, bridgeZ + side * 0.96)
      this.group.add(guard)
      for (let x = -8; x <= 8; x += 2) {
        const post = new THREE.Mesh(this.box(0.08, 0.82, 0.08), guardMat)
        post.position.set(x, deckY + 0.4, bridgeZ + side * 0.96)
        this.group.add(post)
      }
    }

    // Stairs and compact lift towers make the bridge a usable station link,
    // rather than a free-floating frame over the tracks.
    for (const x of [-7.8, 7.8]) {
      this.buildUrbanFootbridgeStair(x, bridgeZ, x < 0 ? -1 : 1, metalMat, guardMat)
      const lift = new THREE.Mesh(this.box(1.7, deckY, 1.7), guardMat)
      lift.position.set(x, deckY / 2, bridgeZ)
      lift.castShadow = true
      this.group.add(lift)
      const liftGlass = new THREE.Mesh(
        this.box(1.76, 3.4, 0.05),
        this.track(new THREE.MeshStandardMaterial({ color: 0x9fb5bf, transparent: true, opacity: 0.38, roughness: 0.22, metalness: 0.28 })),
      )
      liftGlass.position.set(x, 2.65, bridgeZ + 0.88)
      this.group.add(liftGlass)
    }
  }

  private buildUrbanFootbridgeStair(
    x: number,
    bridgeZ: number,
    direction: number,
    stairMat: THREE.Material,
    railMat: THREE.Material,
  ) {
    const steps = 13
    const rise = 5.15 / steps
    const run = 0.52
    for (let index = 0; index < steps; index++) {
      const y = (index + 1) * rise / 2
      const z = bridgeZ + direction * (1.15 + index * run)
      const step = new THREE.Mesh(this.box(1.8, (index + 1) * rise, run), stairMat)
      step.position.set(x, y, z)
      step.castShadow = true
      this.group.add(step)
    }
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(this.box(0.08, 0.08, Math.hypot(5.15, steps * run)), railMat)
      rail.position.set(x + side * 0.82, 3.08, bridgeZ + direction * 4.2)
      rail.rotation.x = direction * Math.atan2(5.15, steps * run)
      this.group.add(rail)
      for (let index = 1; index < steps; index += 3) {
        const y = index * rise + 0.42
        const z = bridgeZ + direction * (1.15 + index * run)
        const post = new THREE.Mesh(this.box(0.08, 0.84, 0.08), railMat)
        post.position.set(x + side * 0.82, y, z)
        this.group.add(post)
      }
    }
  }

  /** A deep reveal, sill and mullions give each bay an actual construction
   * depth instead of reading as a glowing rectangle pasted onto the hall. */
  private addHallWindow(
    hall: THREE.Group,
    layout: StationHallFacadeLayout,
    z: number,
    trimMat: THREE.Material,
    insetMat: THREE.Material,
    glassMat: THREE.Material,
  ) {
    const reveal = new THREE.Mesh(this.box(0.14, 2.12, 2.38), insetMat)
    reveal.position.set(layout.frontX - 0.045, 2.35, z)
    hall.add(reveal)

    const pane = new THREE.Mesh(this.box(0.04, 1.72, 1.98), glassMat)
    pane.position.set(layout.frontX - 0.13, 2.38, z)
    hall.add(pane)

    for (const y of [1.48, 3.27]) {
      const rail = new THREE.Mesh(this.box(0.16, 0.1, 2.3), trimMat)
      rail.position.set(layout.frontX - 0.16, y, z)
      hall.add(rail)
    }
    for (const offset of [-1.1, 0, 1.1]) {
      const mullion = new THREE.Mesh(this.box(0.16, 1.9, 0.09), trimMat)
      mullion.position.set(layout.frontX - 0.16, 2.38, z + offset)
      hall.add(mullion)
    }
    const sill = new THREE.Mesh(this.box(0.34, 0.12, 2.55), trimMat)
    sill.position.set(layout.frontX - 0.23, 1.44, z)
    hall.add(sill)
  }

  /** A shallow public portico gives the hall a legible entrance from both the
   * forecourt and passenger view without encroaching on the access road. */
  private addHallEntrance(
    hall: THREE.Group,
    layout: StationHallFacadeLayout,
    trimMat: THREE.Material,
    insetMat: THREE.Material,
    metalMat: THREE.Material,
    glassMat: THREE.Material,
  ) {
    const entryRecess = new THREE.Mesh(this.box(0.2, 3.05, layout.entranceWidth), insetMat)
    entryRecess.position.set(layout.frontX - 0.06, 1.58, 0)
    hall.add(entryRecess)

    const canopy = new THREE.Mesh(this.box(1.3, 0.2, layout.entranceWidth + 0.72), trimMat)
    canopy.position.set(layout.porticoX, 3.35, 0)
    canopy.castShadow = true
    hall.add(canopy)
    const canopyLip = new THREE.Mesh(this.box(1.36, 0.08, layout.entranceWidth + 0.88), metalMat)
    canopyLip.position.set(layout.porticoX - 0.04, 3.22, 0)
    hall.add(canopyLip)

    for (const z of [-layout.entranceWidth / 2, layout.entranceWidth / 2]) {
      const column = new THREE.Mesh(this.box(0.22, 3.15, 0.22), trimMat)
      column.position.set(layout.porticoX - 0.42, 1.58, z)
      column.castShadow = true
      hall.add(column)
      const footing = new THREE.Mesh(this.box(0.38, 0.18, 0.38), metalMat)
      footing.position.set(layout.porticoX - 0.42, 0.09, z)
      hall.add(footing)
    }

    for (const z of [-0.57, 0.57]) {
      const door = new THREE.Mesh(this.box(0.05, 2.25, 1.02), glassMat)
      door.position.set(layout.frontX - 0.17, 1.32, z)
      hall.add(door)
      const vertical = new THREE.Mesh(this.box(0.16, 2.42, 0.08), metalMat)
      vertical.position.set(layout.frontX - 0.2, 1.32, z + (z < 0 ? -0.52 : 0.52))
      hall.add(vertical)
    }
    const centerMullion = new THREE.Mesh(this.box(0.16, 2.42, 0.08), metalMat)
    centerMullion.position.set(layout.frontX - 0.2, 1.32, 0)
    hall.add(centerMullion)
    const transom = new THREE.Mesh(this.box(0.05, 0.42, 2.14), glassMat)
    transom.position.set(layout.frontX - 0.17, 2.68, 0)
    hall.add(transom)
    const threshold = new THREE.Mesh(this.box(0.44, 0.09, 2.5), metalMat)
    threshold.position.set(layout.frontX - 0.24, 0.08, 0)
    hall.add(threshold)

    for (let step = 0; step < 3; step++) {
      const tread = new THREE.Mesh(this.box(0.55 + step * 0.24, 0.12, layout.entranceWidth + 0.58 + step * 0.24), trimMat)
      tread.position.set(layout.stepX + 0.24 - step * 0.24, 0.3 - step * 0.12, 0)
      tread.castShadow = true
      hall.add(tread)
    }
  }

  private addHallClock(
    hall: THREE.Group,
    layout: StationHallFacadeLayout,
    metalMat: THREE.Material,
    faceMat: THREE.Material,
  ) {
    const clockZ = 8.35
    const housing = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.46, 0.46, 0.13, 16)), metalMat)
    housing.rotation.z = Math.PI / 2
    housing.position.set(layout.frontX - 0.16, 4.12, clockZ)
    hall.add(housing)
    const face = new THREE.Mesh(this.track(new THREE.CircleGeometry(0.34, 16)), faceMat)
    face.rotation.y = -Math.PI / 2
    face.position.set(layout.frontX - 0.24, 4.12, clockZ)
    hall.add(face)
    const minuteHand = new THREE.Mesh(this.box(0.025, 0.19, 0.035), metalMat)
    minuteHand.position.set(layout.frontX - 0.26, 4.2, clockZ)
    hall.add(minuteHand)
    const hourHand = new THREE.Mesh(this.box(0.025, 0.035, 0.14), metalMat)
    hourHand.position.set(layout.frontX - 0.26, 4.12, clockZ - 0.06)
    hall.add(hourHand)
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

  /** Compact platform display: location data comes from the actual Station name. */
  private makePlatformSignTexture(name: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = 560
    canvas.height = 92
    const context = canvas.getContext('2d')!

    context.fillStyle = '#17344e'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#f5f3ea'
    context.font = '700 36px sans-serif'
    context.textAlign = 'right'
    context.textBaseline = 'middle'
    context.fillText(name, 368, 48)
    context.fillStyle = '#e8d99e'
    context.fillRect(392, 12, 72, 68)
    context.fillStyle = '#17344e'
    context.font = '700 52px sans-serif'
    context.textAlign = 'center'
    context.fillText('1', 428, 48)
    context.fillStyle = '#a8d3e1'
    context.font = '700 32px sans-serif'
    context.fillText('B', 510, 48)

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

  /** Soft alpha pool used beneath the existing platform lamp fixtures. */
  private makePlatformGlowTexture(): THREE.CanvasTexture {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')!
    const gradient = context.createRadialGradient(
      size / 2, size / 2, size * 0.06,
      size / 2, size / 2, size / 2,
    )
    gradient.addColorStop(0, 'rgba(255,255,255,0.42)')
    gradient.addColorStop(0.48, 'rgba(255,255,255,0.14)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
    const texture = this.track(new THREE.CanvasTexture(canvas))
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }

  updateLighting(ambientIntensity: number) {
    const level = stationNightLightLevel(ambientIntensity)
    for (const light of this.nightLitMaterials) {
      light.material.emissiveIntensity = light.baseIntensity * level
    }
    if (this.platformGlowMaterial) this.platformGlowMaterial.opacity = 0.26 * level
  }

  private registerNightMaterial(material: THREE.MeshStandardMaterial, baseIntensity: number) {
    this.nightLitMaterials.push({ material, baseIntensity })
    return material
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
  private routePlan: RoutePlan

  /** The manager must retain the longest profile until its scaled geometry
   * has actually cleared the camera, rather than using the regional baseline. */
  static readonly PLATFORM_LENGTH = PLATFORM_LENGTH * STATION_PROFILES['urban-through'].scaleZ
  /** Place the station building just ahead of the final side-window sightline. */
  static readonly APPROACH_STATION_LEAD = 18
  /** Extra distance past the platform edge before hiding (units). */
  private static readonly HIDE_BUFFER = 60
  /** Grace period after the station leaves view before hiding (seconds). */
  private static readonly HIDE_DELAY = 0.8

  constructor(routePlan: RoutePlan = DEFAULT_ROUTE_PLAN) {
    this.routePlan = routePlan
  }

  /** Show a station at the given Z center. Replaces any existing station. */
  showStation(name: string, zCenter: number, kind?: StationVisualKind) {
    this.hideStation()
    this.current = new Station(name, zCenter, kind ?? stationVisualKindAt(zCenter, this.routePlan))
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
  update(camZ: number, dt: number, ambientIntensity = 0.45) {
    if (!this.current) return
    this.current.updateLighting(ambientIntensity)
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
