import { createNoise2D } from 'simplex-noise'
import type { HeightParams } from './Biome'

/** Track runs along Z at x=0. Terrain is flattened to rail-bed level nearby,
 *  both to avoid clipping through the train and to mimic a real rail corridor. */
export const TRACK_BED_HEIGHT = 0
export const TRACK_FLAT_HALF = 10 // fully flat within |x| < this
export const TRACK_BLEND_END = 60 // smooth blend out to natural terrain

// ---- River channel (active in the river biome) ----
export const RIVER_HALF_WIDTH = 8 // flat water surface half-width
export const RIVER_BANK = 18 // carve falls off over this distance
export const RIVER_DEPTH = 2.6 // max carve depth at the channel center
export const WATER_LEVEL = -0.85 // water surface height at full river strength

/** Meandering river centerline, world x for a given z.
 *  Kept close enough that the water is visible over the corridor verge
 *  from the low side-window camera, but clear of the track bed. */
export function riverCenterX(z: number): number {
  return 44 + Math.sin(z * 0.0032) * 9 + Math.sin(z * 0.0009 + 2.1) * 5
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
    if (dist < TRACK_BLEND_END) {
      if (dist <= TRACK_FLAT_HALF) {
        height = TRACK_BED_HEIGHT
      } else {
        const t = smoothstep((dist - TRACK_FLAT_HALF) / (TRACK_BLEND_END - TRACK_FLAT_HALF))
        height = TRACK_BED_HEIGHT + (height - TRACK_BED_HEIGHT) * t
      }
    }

    // River channel SECOND, so the carve cuts through the corridor blend
    // zone instead of being flattened away by it (that was hiding the water).
    // A guard keeps the carve off the rail bed / country road strip.
    const river = params.river ?? 0
    if (river > 0.01) {
      const dRiver = Math.abs(x - riverCenterX(z))
      if (dRiver < RIVER_BANK) {
        const guard = smoothstep(Math.min(Math.max((dist - 12) / 8, 0), 1))
        height -= smoothstep(1 - dRiver / RIVER_BANK) * RIVER_DEPTH * river * guard
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
