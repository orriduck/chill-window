import { MathUtils } from 'three'

export type TerrainSourceMode = 'current' | 'raw20m' | 'putnam2019'
export const PUTNAM_BOUNDS = [-258, 6170, 188, 6670] as const
export const PUTNAM_TRANSITION = 32
const WIDTH = 224, HEIGHT = 251, STEP = 2, COUNT = WIDTH * HEIGHT
// Trust anchors are fixed in code, never supplied by the downloaded manifest.
export const PUTNAM_MANIFEST_SHA = 'a3255a46fae172f77c6294956f7c5944f3b06cf57f1fcf496abb68a4ccd8470d'
const ELEVATION_SHA = '2bd344e5e552a1003eb14940cdf287e80277d3054bd58ec4d53be5136eb7f923'
const MASK_SHA = 'c5459bafad65454f39bfb3ac2e5a3ab13f1cfd897457d58402a753b0e7a247c3'
const WORLD_SHA = 'c4a2eaea1d1ffc3d1f9c346dcceb812f10a4efb9755da146d4c18249002393ec'

export function terrainSourceMode(value: string | null): TerrainSourceMode {
  if (value === null || value === 'current') return 'current'
  if (value === 'raw20m' || value === 'putnam2019') return value
  throw new Error(`Unknown terrainSource: ${value}`)
}
export function putnamWeight(x: number, z: number) {
  const [a, b, c, d] = PUTNAM_BOUNDS
  return MathUtils.smoothstep(Math.min(x - a, z - b, c - x, d - z), 0, PUTNAM_TRANSITION)
}
export function putnamTile(cx: number, cz: number) {
  const [a, b, c, d] = PUTNAM_BOUNDS
  return cx * 256 < c && (cx + 1) * 256 > a && cz * 256 < d && (cz + 1) * 256 > b
}
async function verified(url: string, bytes: number | null, sha: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Putnam source HTTP ${response.status}: ${url}`)
  const buffer = await response.arrayBuffer()
  if (bytes !== null && buffer.byteLength !== bytes) throw new Error(`Putnam source size mismatch: ${url}`)
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), n => n.toString(16).padStart(2, '0')).join('')
  if (digest !== sha) throw new Error(`Putnam source SHA mismatch: ${url}`)
  return buffer
}
/** Authenticated derived 2m grid. This is not the raw 1m source or visual acceptance. */
export class GeoNativeTerrain {
  readonly manifestSha = PUTNAM_MANIFEST_SHA
  private elevations: Float32Array
  private valid: Uint8Array
  private constructor(elevations: Float32Array, valid: Uint8Array) { this.elevations = elevations; this.valid = valid }
  static async load(signal?: AbortSignal) {
    const base = '/geodata/hudson/putnam-2790/'
    const [manifestBytes, elevationBytes, maskBytes] = await Promise.all([
      verified(`${base}manifest.json`, 3310, PUTNAM_MANIFEST_SHA, signal),
      verified(`${base}elevation.f32`, COUNT * 4, ELEVATION_SHA, signal),
      verified(`${base}valid.u8`, COUNT, MASK_SHA, signal),
      verified('/geodata/hudson/world.json', null, WORLD_SHA, signal),
    ])
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes))
    if (manifest.width !== WIDTH || manifest.height !== HEIGHT || manifest.stepMetres !== STEP || manifest.vertexCount !== COUNT
      || JSON.stringify(manifest.bounds) !== JSON.stringify(PUTNAM_BOUNDS) || JSON.stringify(manifest.origin) !== '[-73.96,41.36]'
      || manifest.worldSha256 !== WORLD_SHA || manifest.validCount !== COUNT || manifest.nodataCount !== 0 || manifest.verticalAdjustmentApplied !== false)
      throw new Error('Putnam grid geometry/datum/count mismatch')
    const view = new DataView(elevationBytes), heights = new Float32Array(COUNT), valid = new Uint8Array(maskBytes)
    let validCount = 0
    for (let i = 0; i < COUNT; i++) {
      heights[i] = view.getFloat32(i * 4, true)
      if (valid[i] !== 0 && valid[i] !== 1) throw new Error('Putnam invalid mask encoding')
      if (valid[i]) { if (!Number.isFinite(heights[i])) throw new Error('Putnam nonfinite valid elevation'); validCount++ }
    }
    if (validCount !== COUNT) throw new Error('Putnam valid count mismatch')
    return new GeoNativeTerrain(heights, valid)
  }
  sample(x: number, z: number): number | null {
    const gx = (x - PUTNAM_BOUNDS[0]) / STEP, gz = (z - PUTNAM_BOUNDS[1]) / STEP
    if (gx < 0 || gz < 0 || gx > WIDTH - 1 || gz > HEIGHT - 1) return null
    const col = Math.min(Math.floor(gx), WIDTH - 2), row = Math.min(Math.floor(gz), HEIGHT - 2)
    const a = row * WIDTH + col, b = a + 1, c = a + WIDTH, d = c + 1
    if (![a, b, c, d].every(i => this.valid[i] === 1 && Number.isFinite(this.elevations[i]))) return null
    return MathUtils.lerp(MathUtils.lerp(this.elevations[a], this.elevations[b], gx - col), MathUtils.lerp(this.elevations[c], this.elevations[d], gx - col), gz - row)
  }
}
