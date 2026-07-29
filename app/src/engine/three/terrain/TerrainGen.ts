import { createNoise2D } from 'simplex-noise'
import type { HeightParams } from './Biome'
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

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

export class TerrainGen {
  private noise = createNoise2D()
  private routePlan: RoutePlan

  constructor(routePlan: RoutePlan = DEFAULT_ROUTE_PLAN) {
    this.routePlan = routePlan
  }

  /** Low-frequency patchiness (0..1) for mottled meadow coloring. */
  getMottle(x: number, z: number): number {
    return this.noise(x * 0.018 + 137.3, z * 0.018 + 291.7) * 0.5 + 0.5
  }

  getHeight(x: number, z: number, params: HeightParams): number {
    let height = params.baseHeight
    let amplitude = params.amplitude
    let frequency = params.frequency

    for (let i = 0; i < params.octaves; i++) {
      height += this.noise(x * frequency, z * frequency) * amplitude
      amplitude *= params.persistence
      frequency *= 2
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
    if (river > 0.01) {
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
      if (channel.lakeStrength > 0.01) {
        const farRoadD = Math.abs(x - farBankRoadCenterX(z, this.routePlan))
        if (farRoadD < ROAD_VERGE) {
          const edgeT = Math.min(Math.max((farRoadD - ROAD_HALF_WIDTH) / (ROAD_VERGE - ROAD_HALF_WIDTH), 0), 1)
          const roadWeight = (1 - smoothstep(edgeT)) * channel.lakeStrength
          const roadElevation = trackElevationAt(z) - 0.15
          height = height * (1 - roadWeight) + roadElevation * roadWeight
        }
      }
    }

    // Roads are engineered surfaces, not painted stripes following every
    // meadow ripple. A narrow, eased roadbed ties the access lane to station
    // forecourts and bridge approaches while leaving the surrounding terrain
    // naturally irregular. The road mesh samples this exact height function.
    const road = params.road ?? 0
    if (road > 0.01) {
      const roadDistance = Math.abs(x - roadCenterX(z))
      if (roadDistance < ROAD_VERGE) {
        const edge = (roadDistance - ROAD_HALF_WIDTH) / (ROAD_VERGE - ROAD_HALF_WIDTH)
        const roadWeight = (1 - smoothstep(Math.min(Math.max(edge, 0), 1))) * Math.min(1, road * 2)
        const roadbed = trackElevationAt(z) - 0.12
        height = height * (1 - roadWeight) + roadbed * roadWeight
      }
    }

    return height
  }

  getNormal(x: number, z: number, params: HeightParams, epsilon = 0.5): { nx: number; ny: number; nz: number } {
    const hL = this.getHeight(x - epsilon, z, params)
    const hR = this.getHeight(x + epsilon, z, params)
    const hD = this.getHeight(x, z - epsilon, params)
    const hU = this.getHeight(x, z + epsilon, params)

    const nx = hL - hR
    const nz = hD - hU
    const len = Math.sqrt(nx * nx + 4 * epsilon * epsilon + nz * nz)

    return { nx: nx / len, ny: 2 * epsilon / len, nz: nz / len }
  }

  getSlope(x: number, z: number, params: HeightParams): number {
    const hL = this.getHeight(x - 0.5, z, params)
    const hR = this.getHeight(x + 0.5, z, params)
    const hD = this.getHeight(x, z - 0.5, params)
    const hU = this.getHeight(x, z + 0.5, params)
    const dx = Math.abs(hR - hL)
    const dz = Math.abs(hU - hD)
    return Math.sqrt(dx * dx + dz * dz)
  }
}
