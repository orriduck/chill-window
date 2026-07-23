import { createNoise2D } from 'simplex-noise'
import type { HeightParams } from './Biome'

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
