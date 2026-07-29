/** Deterministic helpers for procedural scenery.
 *
 * World generation must derive from coordinates, never load timing. That
 * keeps a chunk identical when it is evicted, prewarmed, or revisited. */
export type RandomSource = () => number

export function hash01(x: number, y = 0, salt = 0): number {
  const value = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453123
  return value - Math.floor(value)
}

export function seedFromGrid(x: number, z: number, salt = 0): number {
  return Math.floor(hash01(x, z, salt) * 0xffffffff) >>> 0
}

export function createSeededRandom(seed: number): RandomSource {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function between(random: RandomSource, min: number, max: number): number {
  return min + (max - min) * random()
}
