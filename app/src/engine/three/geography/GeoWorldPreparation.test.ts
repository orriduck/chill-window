import { describe, expect, it, vi } from 'vitest'
import { RealWorld } from './RealWorld'

// The observation needs no asset download, DOM canvas or GPU construction.
vi.mock('../textures', () => ({ groundGrassTex: {}, groundRockTex: {}, geographicTexturesReady: Promise.resolve([]) }))

describe('initial current-view GPU evidence', () => {
  it('reads actual uploaded current tiles separately from later offscreen pending work', () => {
    const keys = Array.from({ length: 49 }, (_, i) => `current-${i}`)
    const chunks = new Map(keys.map(key => [key, { gpuReady: true }]))
    const owner = { data: { pose: () => ({ x: 100, z: 200 }) },
      tilesAt: () => new Map(keys.map(key => [key, {}])), chunks } as unknown as RealWorld
    expect(RealWorld.prototype.gpuCoverageAt.call(owner, 3123.283)).toEqual({ readyTiles: 49, totalTiles: 49, pendingGpu: 0 })
    chunks.set('offscreen-forward', { gpuReady: false })
    expect(RealWorld.prototype.gpuCoverageAt.call(owner, 3123.283)).toEqual({ readyTiles: 49, totalTiles: 49, pendingGpu: 1 })
    chunks.set(keys[0], { gpuReady: false })
    expect(RealWorld.prototype.gpuCoverageAt.call(owner, 3123.283)).toEqual({ readyTiles: 48, totalTiles: 49, pendingGpu: 2 })
    chunks.delete(keys[1])
    expect(RealWorld.prototype.gpuCoverageAt.call(owner, 3123.283)).toEqual({ readyTiles: 47, totalTiles: 49, pendingGpu: 2 })
  })
})
