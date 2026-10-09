import { createNoise2D } from 'simplex-noise'
import { FIELD_LANES, fieldParcelAt } from './FieldLayout'
import { createSeededRandom, hash01 } from '../core/procedural'
import type { TerrainEdits } from './TerrainEdits'
import { CHUNK_SIZE } from './DecorationPlacement'
import type { HeightParams } from './Biome'
import { landscapeAt } from './Landscape'
import { trackElevationAt } from './RouteProfile'
import { DEFAULT_ROUTE_PLAN, lakeBasinStrengthAt, type RoutePlan } from './RouteFeatures'

/** Track runs along Z at x=0. Terrain is flattened to rail-bed level nearby,
 *  both to avoid clipping through the train and to mimic a real rail corridor. */
export const TRACK_FLAT_HALF = 10 // fully flat within |x| < this
export const TRACK_BLEND_END = 60 // smooth blend out to natural terrain

// ---- River channel (active in the river biome) ----
export const RIVER_HALF_WIDTH = 11 // flat water surface half-width
export const RIVER_BANK = 22 // carve falls off over this distance
export const RIVER_DEPTH = 2.6 // max carve depth at the channel center
export const WATER_LEVEL = -0.85 // water surface height at full river strength
export const LAKE_HALF_WIDTH_BONUS = 24
export const LAKE_CENTER_SHIFT = 24
export const MAX_WATER_HALF_WIDTH = RIVER_HALF_WIDTH + LAKE_HALF_WIDTH_BONUS

/** Meandering river centerline, world x for a given z.
 *  Kept close enough that the water is visible over the corridor verge
 *  from the low side-window camera, but clear of the track bed. */
export function riverCenterX(z: number): number {
  return 44 + Math.sin(z * 0.0032) * 9 + Math.sin(z * 0.0009 + 2.1) * 5
}

/** Water, terrain banks, and far-bank access use this one channel profile.
 * The lakeshore widens away from the rail so the existing parallel road keeps
 * a dry, believable verge instead of being swallowed by the water. */
export function waterChannelAt(z: number, plan: RoutePlan = DEFAULT_ROUTE_PLAN): {
  centerX: number
  halfWidth: number
  bankHalfWidth: number
  lakeStrength: number
} {
  const lakeStrength = lakeBasinStrengthAt(z, plan)
  const halfWidth = RIVER_HALF_WIDTH + lakeStrength * LAKE_HALF_WIDTH_BONUS
  return {
    centerX: riverCenterX(z) + lakeStrength * LAKE_CENTER_SHIFT,
    halfWidth,
    bankHalfWidth: halfWidth + (RIVER_BANK - RIVER_HALF_WIDTH),
    lakeStrength,
  }
}

/** A small far-bank service road continues from the valley bridge to the
 * river village. Keeping it tied to the river prevents a settlement from
 * looking independently scattered across the valley. */
export function farBankRoadCenterX(z: number, plan: RoutePlan = DEFAULT_ROUTE_PLAN): number {
  const channel = waterChannelAt(z, plan)
  return channel.centerX + channel.halfWidth + 14
}

/** River surface shares the route elevation so valley infrastructure and
 * water stay vertically coherent through the route's gentle grades. */
export function riverWaterElevationAt(z: number, strength = 1): number {
  return trackElevationAt(z) - 0.75 - (Math.abs(WATER_LEVEL) - 0.75) * strength
}

/** Country road centerline, roughly paralleling the track on the view side.
 *  Sits just beyond the lineside fence, gently weaving. */
export function roadCenterX(z: number): number {
  return 20 + Math.sin(z * 0.0025 + 0.8) * 4
}
export const ROAD_HALF_WIDTH = 3.0
export const ROAD_VERGE = 4.8 // grass blend-out distance
/** Top elevation of the shared country-road formation relative to rail. */
export const ROADBED_OFFSET = -0.12

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

export class TerrainGen {
  private noise = (() => { let i = 0; return createNoise2D(() => hash01(i++, 17, 91)) })()
  private routePlan: RoutePlan
  private edits?: TerrainEdits
  private patchElevationOffsets = new Map<string, number>()

  constructor(routePlan: RoutePlan = DEFAULT_ROUTE_PLAN, edits?: TerrainEdits) {
    this.routePlan = routePlan
    this.edits = edits
    if (routePlan.continuous) this.noise = createNoise2D(createSeededRandom(routePlan.seed))
  }

  /** Low-frequency patchiness (0..1) for mottled meadow coloring. */
  getMottle(x: number, z: number): number {
    return this.noise(x * 0.018 + 137.3, z * 0.018 + 291.7) * 0.5 + 0.5
  }

  private naturalHeight(x: number, z: number, params: HeightParams): number {
    let height = params.baseHeight
    let amplitude = params.amplitude
    let frequency = params.frequency

    for (let i = 0; i < params.octaves; i++) {
      height += this.noise(x * frequency, z * frequency) * amplitude
      amplitude *= params.persistence
      frequency *= 2
    }

    // Broad positive ridges produce readable mountain masses, not signed
    // noise pits. The same world-space field also forms the valley walls.
    const warp = this.routePlan.continuous ? this.noise(x * 0.0007 + 17, z * 0.0007 + 59) * 45 : 0
    const ridgeNoise = this.noise((x + warp) * 0.0018 + 83, (z - warp) * 0.0018)
    const ridge = this.routePlan.continuous ? Math.max(0, 1 - Math.sqrt(ridgeNoise * ridgeNoise + 0.04)) ** 2 : (1 - Math.abs(ridgeNoise)) ** 2
    const shoulder = smoothstep(Math.min(1, Math.max(0, (Math.abs(x) - 38) / 230)))
    height += (params.ridge ?? 0) * shoulder * (28 + ridge * 110)
    const valleyWall = smoothstep(Math.min(1, Math.max(0, (Math.abs(x) - 115) / 230)))
    height += (params.valley ?? 0) * valleyWall * (32 + ridge * 90)
    return height
  }

  getBaseHeight(x: number, z: number, params: HeightParams): number {
    let height = this.naturalHeight(x, z, params.naturalSource ?? params)
    if (params.blendTarget && params.blendWeight) {
      const other = this.naturalHeight(x, z, params.blendTarget)
      height += (other - height) * params.blendWeight
    }

    // Corridor flattening first: rail bed stays level near the track.
    const dist = Math.abs(x)
    const trackBedHeight = trackElevationAt(z)
    if (dist < TRACK_BLEND_END) {
      if (dist <= TRACK_FLAT_HALF) {
        height = trackBedHeight
      } else {
        const t = smoothstep((dist - TRACK_FLAT_HALF) / (TRACK_BLEND_END - TRACK_FLAT_HALF))
        height = trackBedHeight + (height - trackBedHeight) * t
      }
    }

    // River channel SECOND, so the carve cuts through the corridor blend
    // zone instead of being flattened away by it (that was hiding the water).
    // Guards keep the carve off the rail bed and the parallel valley road.
    const river = params.river ?? 0
    if (river > 0) {
      const channel = waterChannelAt(z, this.routePlan)
      const dRiver = Math.abs(x - channel.centerX)
      if (dRiver < channel.bankHalfWidth) {
        const railGuard = smoothstep(Math.min(Math.max((dist - 12) / 8, 0), 1))
        const roadDistance = Math.abs(x - roadCenterX(z))
        const roadGuard = smoothstep(Math.min(Math.max((roadDistance - ROAD_HALF_WIDTH) / 3.5, 0), 1))
        const bankT = Math.min(Math.max((dRiver - channel.halfWidth) / (channel.bankHalfWidth - channel.halfWidth), 0), 1)
        const bankCarve = 1 - smoothstep(bankT)
        // The full water surface is a flat channel bed; the eased outer bank
        // meets it continuously, so a widened lake cannot expose dry ridges.
        height -= bankCarve * RIVER_DEPTH * river * railGuard * roadGuard
      }

      // The far-bank service road continues the bridge/village access along
      // the open lakeshore. It is slightly above the water and fades back to
      // natural terrain with the same basin strength that shapes the shore.
      if (channel.lakeStrength > 0) {
        const farRoadD = Math.abs(x - farBankRoadCenterX(z, this.routePlan))
        if (farRoadD < ROAD_VERGE) {
          const edgeT = Math.min(Math.max((farRoadD - ROAD_HALF_WIDTH) / (ROAD_VERGE - ROAD_HALF_WIDTH), 0), 1)
          const roadWeight = (1 - smoothstep(edgeT)) * channel.lakeStrength
          const roadElevation = trackElevationAt(z) - 0.15
          height = height * (1 - roadWeight) + roadElevation * roadWeight
        }
      }
    }

    // Huzhou-inspired lowland parcels: level pond beds, raised planted dykes,
    // and rice plots share their exact footprints with FieldPlots.
    const farmland = params.farmland ?? 0
    if (farmland > 0 && x > 30 && x < 272) {
      const edge = smoothstep(Math.min(1, (x - 30) / 8)) * smoothstep(Math.min(1, (272 - x) / 12))
      const parcel = fieldParcelAt(x, z)
      let farmHeight = trackBedHeight - 0.48
      if (parcel) {
        const lane = FIELD_LANES[parcel.lane]
        const across = smoothstep(Math.min(1, Math.max(0, (lane.width / 2 - Math.abs(x - lane.x)) / 8)))
        const plateau = across * (1 - smoothstep(Math.min(1, Math.max(0, (Math.abs(z - parcel.centerZ) - 35) / 15))))
        farmHeight += (trackElevationAt(parcel.centerZ) - 0.48 - farmHeight) * plateau
        if (parcel.pond) {
          const lane = FIELD_LANES[parcel.lane]
          const inner = Math.min(lane.width / 2 - Math.abs(x - lane.x), 46 - Math.abs(z - parcel.centerZ))
          farmHeight -= smoothstep(Math.min(1, Math.max(0, (inner - 2) / 5))) * 1.6
        }
      }
      // Longitudinal drainage canal joins the parcel network between dykes.
      const canal = Math.max(0, 1 - Math.abs(x - 88) / 4)
      farmHeight -= canal * 1.6
      height += (farmHeight - height) * farmland * edge
    }

    // Roads are engineered surfaces, not painted stripes following every
    // meadow ripple. A narrow, eased roadbed ties the access lane to station
    // forecourts and bridge approaches while leaving the surrounding terrain
    // naturally irregular. The road mesh samples this exact height function.
    const road = params.road ?? 0
    if (road > 0) {
      const roadDistance = Math.abs(x - roadCenterX(z))
      if (roadDistance < ROAD_VERGE) {
        const edge = (roadDistance - ROAD_HALF_WIDTH) / (ROAD_VERGE - ROAD_HALF_WIDTH)
        const roadWeight = (1 - smoothstep(Math.min(Math.max(edge, 0), 1))) * Math.min(1, road * 2)
        const roadbed = trackElevationAt(z) + ROADBED_OFFSET
        height = height * (1 - roadWeight) + roadbed * roadWeight
      }
    }

    return height
  }

  getHeight(x: number, z: number, params: HeightParams): number {
    let height = this.getBaseHeight(x, z, params)
    const dist = Math.abs(x), trackBedHeight = trackElevationAt(z)
    const patch = this.edits?.sample(x, z)
    if (patch) {
      let target = patch.height
      if (patch.settings.scene !== 'valley') {
        // Grade a settlement at its existing local elevation, rather than
        // excavating every hillside tile down to the distant railway bed.
        const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE), key = `${cx},${cz}`
        let offset = this.patchElevationOffsets.get(key)
        if (offset === undefined) {
          const mx = (cx + 0.5) * CHUNK_SIZE, mz = (cz + 0.5) * CHUNK_SIZE
          offset = this.getBaseHeight(mx, mz, landscapeAt(mz, this.routePlan).params) - (trackElevationAt(mz) - 0.35)
          this.patchElevationOffsets.set(key, offset)
        }
        target += offset
      }
      // Keep engineering continuous even while freely changing a map tile.
      const corridor = smoothstep(Math.min(1, Math.max(0, (dist - TRACK_FLAT_HALF) / (TRACK_BLEND_END - TRACK_FLAT_HALF))))
      const localHeight = trackBedHeight + (target - trackBedHeight) * corridor
      height += (localHeight - height) * patch.weight
    }
    return height
  }

  getNormal(x: number, z: number, params: HeightParams, epsilon = 0.5): { nx: number; ny: number; nz: number } {
    const hL = this.getHeight(x - epsilon, z, params)
    const hR = this.getHeight(x + epsilon, z, params)
    const hD = this.getHeight(x, z - epsilon, params.blendWeight !== undefined ? landscapeAt(z - epsilon, this.routePlan).params : params)
    const hU = this.getHeight(x, z + epsilon, params.blendWeight !== undefined ? landscapeAt(z + epsilon, this.routePlan).params : params)

    const nx = hL - hR
    const nz = hD - hU
    const len = Math.sqrt(nx * nx + 4 * epsilon * epsilon + nz * nz)

    return { nx: nx / len, ny: 2 * epsilon / len, nz: nz / len }
  }

  getSlope(x: number, z: number, params: HeightParams): number {
    const hL = this.getHeight(x - 0.5, z, params)
    const hR = this.getHeight(x + 0.5, z, params)
    const hD = this.getHeight(x, z - 0.5, params.blendWeight !== undefined ? landscapeAt(z - 0.5, this.routePlan).params : params)
    const hU = this.getHeight(x, z + 0.5, params.blendWeight !== undefined ? landscapeAt(z + 0.5, this.routePlan).params : params)
    const dx = Math.abs(hR - hL)
    const dz = Math.abs(hU - hD)
    return Math.sqrt(dx * dx + dz * dz)
  }
}
