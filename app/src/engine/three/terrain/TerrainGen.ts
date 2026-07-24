import { createNoise2D } from 'simplex-noise'
import type { HeightParams } from './Biome'

/** Track runs along Z at x=0. Terrain is flattened to rail-bed level nearby,
 *  both to avoid clipping through the train and to mimic a real rail corridor. */
export const TRACK_BED_HEIGHT = 0
export const TRACK_FLAT_HALF = 10 // fully flat within |x| < this
export const TRACK_BLEND_END = 60 // smooth blend out to natural terrain

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

export class TerrainGen {
  private noise = createNoise2D()

  getHeight(x: number, z: number, params: HeightParams): number {
    let height = params.baseHeight
    let amplitude = params.amplitude
    let frequency = params.frequency

    for (let i = 0; i < params.octaves; i++) {
      height += this.noise(x * frequency, z * frequency) * amplitude
      amplitude *= params.persistence
      frequency *= 2
    }

    const dist = Math.abs(x)
    if (dist >= TRACK_BLEND_END) return height
    if (dist <= TRACK_FLAT_HALF) return TRACK_BED_HEIGHT
    const t = smoothstep((dist - TRACK_FLAT_HALF) / (TRACK_BLEND_END - TRACK_FLAT_HALF))
    return TRACK_BED_HEIGHT + (height - TRACK_BED_HEIGHT) * t
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
