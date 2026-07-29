import { describe, expect, it } from 'vitest'
import { createSeededRandom, hash01, seedFromGrid } from '../core/procedural'
import {
  MOUNTAIN_TUNNEL_LENGTH,
  MOUNTAIN_TUNNEL_OFFSET,
  RIVER_LAKE_FADE_LENGTH,
  RIVER_LAKE_HALF_LENGTH,
  RIVER_LAKE_OFFSET,
  RIVER_BRIDGE_OFFSET,
  RIVER_VILLAGE_OFFSET,
  lakeBasinStrengthAt,
  ROUTE_BLEND_LENGTH,
  ROUTE_SEGMENT_LENGTH,
  routeFeatureForSegment,
  sampleRouteFeature,
} from './RouteFeatures'

const ROUTE_PERIOD = 5

describe('route features', () => {
  it('repeats its planned features in both positive and negative world coordinates', () => {
    for (let segment = -30; segment <= 30; segment++) {
      expect(routeFeatureForSegment(segment)).toEqual(routeFeatureForSegment(segment + ROUTE_PERIOD))
    }
  })

  it('keeps the transition boundary anchored to the same world coordinates', () => {
    const mountainSegment = 4
    const start = mountainSegment * ROUTE_SEGMENT_LENGTH
    const blendStart = start + ROUTE_SEGMENT_LENGTH - ROUTE_BLEND_LENGTH

    expect(sampleRouteFeature(start)).toMatchObject({
      segmentIndex: mountainSegment,
      segmentStart: start,
      blend: 0,
      current: { biome: 'mountain', tunnel: true },
    })
    expect(sampleRouteFeature(blendStart).blend).toBe(0)
    expect(sampleRouteFeature(start + ROUTE_SEGMENT_LENGTH - 1).blend).toBeGreaterThan(0.99)
    expect(sampleRouteFeature(-1).segmentIndex).toBe(-1)
  })

  it('keeps river and mountain engineering inside their matching route segments', () => {
    const riverSegment = 3
    const mountainSegment = 4
    const riverStart = riverSegment * ROUTE_SEGMENT_LENGTH
    const mountainStart = mountainSegment * ROUTE_SEGMENT_LENGTH
    const bridgeZ = riverStart + RIVER_BRIDGE_OFFSET
    const villageZ = riverStart + RIVER_VILLAGE_OFFSET
    const lakeCenter = riverStart + RIVER_LAKE_OFFSET
    const tunnelCenter = mountainStart + MOUNTAIN_TUNNEL_OFFSET

    expect(routeFeatureForSegment(riverSegment).biome).toBe('river')
    expect(bridgeZ).toBeGreaterThan(riverStart)
    expect(villageZ).toBeGreaterThan(bridgeZ)
    expect(lakeCenter - RIVER_LAKE_HALF_LENGTH - RIVER_LAKE_FADE_LENGTH).toBeGreaterThan(villageZ)
    expect(lakeCenter + RIVER_LAKE_HALF_LENGTH + RIVER_LAKE_FADE_LENGTH).toBeLessThan(riverStart + ROUTE_SEGMENT_LENGTH)
    expect(lakeBasinStrengthAt(lakeCenter)).toBe(1)
    expect(lakeBasinStrengthAt(lakeCenter + RIVER_LAKE_HALF_LENGTH + RIVER_LAKE_FADE_LENGTH)).toBe(0)
    expect(lakeBasinStrengthAt(lakeCenter + RIVER_LAKE_HALF_LENGTH + RIVER_LAKE_FADE_LENGTH / 2)).toBeGreaterThan(0)
    expect(lakeBasinStrengthAt(mountainStart + 20)).toBe(0)

    expect(routeFeatureForSegment(mountainSegment).tunnel).toBe(true)
    expect(tunnelCenter).toBeGreaterThan(mountainStart)
    expect(tunnelCenter + MOUNTAIN_TUNNEL_LENGTH / 2).toBeLessThan(mountainStart + ROUTE_SEGMENT_LENGTH)
  })
})

describe('procedural anchors', () => {
  it('derives the same random sequence for the same grid cell', () => {
    const seed = seedFromGrid(-12, 6400, 51)
    const first = createSeededRandom(seed)
    const second = createSeededRandom(seed)

    expect(Array.from({ length: 8 }, () => first())).toEqual(
      Array.from({ length: 8 }, () => second()),
    )
    expect(hash01(-12, 6400, 51)).toBeGreaterThanOrEqual(0)
    expect(hash01(-12, 6400, 51)).toBeLessThan(1)
  })
})
