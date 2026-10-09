import { createNoise2D } from 'simplex-noise'
import { createSeededRandom, seedFromGrid } from '../core/procedural'
import { getBiomeConfig, type BiomeType } from './Biome'
import { routeBeatForSegment, type RoutePlan } from './RouteFeatures'
import { CHUNK_SIZE } from './DecorationPlacement'
import { trackElevationAt } from './RouteProfile'

export type PatchScene = 'plain' | 'field' | 'village' | 'town' | 'city' | 'forest' | 'mountain' | 'valley'
export const PATCH_SCENES: Record<PatchScene, { label: string; biome: BiomeType; relief: number }> = {
  plain: { label: '平地', biome: 'field', relief: 0.4 },
  field: { label: '农田', biome: 'field', relief: 0.3 },
  village: { label: '村庄', biome: 'field', relief: 0.3 },
  town: { label: '小城市', biome: 'town', relief: 0.25 },
  city: { label: '大城市', biome: 'town', relief: 0.2 },
  forest: { label: '树林', biome: 'forest', relief: 8 },
  mountain: { label: '山地', biome: 'mountain', relief: 65 },
  valley: { label: '山谷', biome: 'river', relief: 20 },
}
export interface PatchSettings { scene: PatchScene; relief: number; seed: number }
export interface PatchSample { settings: PatchSettings; weight: number; height: number }
const ease = (t: number) => { const v = Math.min(1, Math.max(0, t)); return v * v * v * (v * (v * 6 - 15) + 10) }

/** Coordinate-owned patches. Their value and first derivative vanish at an
 * edge, so edits never change a neighbour's vertices or rail alignment. */
export class TerrainEdits {
  private values = new Map<string, { settings: PatchSettings; noise: ReturnType<typeof createNoise2D> }>()
  private plan: RoutePlan
  constructor(plan: RoutePlan) { this.plan = plan }
  settings(x: number, z: number): PatchSettings {
    const stored = this.values.get(`${x},${z}`)
    if (stored) return { ...stored.settings }
    const beat = routeBeatForSegment(Math.floor((z * CHUNK_SIZE + 128) / 1500), this.plan)
    const scene: PatchScene = beat.settlement === 'city-core' ? 'city' : ['urban-edge', 'regional-town'].includes(beat.settlement) ? 'town'
      : beat.settlement === 'village' && beat.biome !== 'river' ? 'village' : beat.biome === 'river' ? 'valley'
      : beat.biome === 'mountain' ? 'mountain' : beat.biome === 'forest' ? 'forest' : beat.id === 'plain' ? 'plain' : 'field'
    return { scene, relief: PATCH_SCENES[scene].relief, seed: seedFromGrid(x, z, this.plan.seed + 151) }
  }
  set(x: number, z: number, settings: PatchSettings) {
    const safe = { ...settings, relief: Math.min(100, Math.max(0, settings.relief)), seed: settings.seed >>> 0 }
    this.values.set(`${x},${z}`, { settings: safe, noise: createNoise2D(createSeededRandom(safe.seed)) })
  }
  reset(x: number, z: number) { this.values.delete(`${x},${z}`) }
  has(x: number, z: number) { return this.values.has(`${x},${z}`) }
  sample(x: number, z: number): PatchSample | null {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE)
    const value = this.values.get(`${cx},${cz}`)
    if (!value) return null
    const lx = x - cx * CHUNK_SIZE, lz = z - cz * CHUNK_SIZE
    const { settings, noise } = value
    const natural = ['mountain', 'valley', 'forest'].includes(settings.scene)
    const rx = lx / 128 - 1, rz = lz / 128 - 1
    // A C2 radial support avoids the square walls and diagonal min() creases
    // of the former 48m strip. Engineered land keeps a central building pad.
    const weight = natural ? Math.max(0, 1 - rx * rx - rz * rz) ** 3
      : ease(Math.min(lx, CHUNK_SIZE - lx) / 64) * ease(Math.min(lz, CHUNK_SIZE - lz) / 64)
    const warp = noise(x * 0.0015 + 37, z * 0.0015 + 73) * 18
    const px = (x + warp) * 0.003, pz = (z - warp) * 0.003
    const coarse = (noise(px, pz) + noise(px * 2 + 41, pz * 2 + 19) * 0.32 + noise(px * 4 + 7, pz * 4 + 97) * 0.08) / 1.4
    let height = trackElevationAt(z) - 0.35 + coarse * settings.relief
    if (settings.scene === 'mountain') {
      const roundedRidge = Math.max(0, 1 - Math.sqrt(coarse * coarse + 0.08))
      height = trackElevationAt(z) - 0.35 + (0.45 + coarse * 0.25 + roundedRidge * 0.35) * settings.relief
    }
    if (settings.scene === 'valley') {
      const channelX = (cx + 0.5) * CHUNK_SIZE + Math.sin(z * 0.013) * 9
      const distance = Math.abs(x - channelX)
      height = trackElevationAt(z) - 2.3 + ease((distance - 12) / 65) * settings.relief + coarse * 0.3
    }
    return { settings, weight, height }
  }
  colors(settings: PatchSettings) { return getBiomeConfig(PATCH_SCENES[settings.scene].biome).colors }
}
