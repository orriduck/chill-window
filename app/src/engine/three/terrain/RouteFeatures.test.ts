import { describe, expect, it } from 'vitest'
import { createSeededRandom, hash01, seedFromGrid } from '../core/procedural'
import { getBiomeConfig } from './Biome'
import { trackElevationAt } from './RouteProfile'
import { farBankRoadCenterX, RIVER_HALF_WIDTH, TerrainGen, waterChannelAt } from './TerrainGen'
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
  routeContextAt,
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
    expect(routeContextAt(lakeCenter)).toEqual({ currentLabel: 'Lakeshore', nextLabel: 'Highlands' })
    expect(routeContextAt(villageZ)).toEqual({ currentLabel: 'River valley', nextLabel: 'Highlands' })
    expect(routeContextAt(mountainStart + 20)).toEqual({ currentLabel: 'Highlands', nextLabel: 'Open fields' })

    const lakeChannel = waterChannelAt(lakeCenter)
    expect(lakeChannel.halfWidth).toBeGreaterThan(RIVER_HALF_WIDTH)
    expect(waterChannelAt(villageZ).halfWidth).toBe(RIVER_HALF_WIDTH)
    expect(farBankRoadCenterX(lakeCenter)).toBeGreaterThan(lakeChannel.centerX + lakeChannel.halfWidth)
    const terrain = new TerrainGen()
    expect(
      terrain.getHeight(
        farBankRoadCenterX(lakeCenter),
        lakeCenter,
        getBiomeConfig('river').heightParams,
      ),
    ).toBeCloseTo(trackElevationAt(lakeCenter) - 0.15, 5)

    expect(routeFeatureForSegment(mountainSegment).tunnel).toBe(true)
    expect(tunnelCenter).toBeGreaterThan(mountainStart)
    expect(tunnelCenter + MOUNTAIN_TUNNEL_LENGTH / 2).toBeLessThan(mountainStart + ROUTE_SEGMENT_LENGTH)
  })

  it('keeps lakeshore labels stable across each eased basin edge', () => {
    const lakeCenter = 3 * ROUTE_SEGMENT_LENGTH + RIVER_LAKE_OFFSET
    const entry = lakeCenter - RIVER_LAKE_HALF_LENGTH - RIVER_LAKE_FADE_LENGTH
    const exit = lakeCenter + RIVER_LAKE_HALF_LENGTH + RIVER_LAKE_FADE_LENGTH

    expect(routeContextAt(entry)).toMatchObject({ currentLabel: 'River valley' })
    expect(routeContextAt(entry + RIVER_LAKE_FADE_LENGTH / 2)).toMatchObject({ currentLabel: 'Lakeshore' })
    expect(routeContextAt(exit - RIVER_LAKE_FADE_LENGTH / 2)).toMatchObject({ currentLabel: 'Lakeshore' })
    expect(routeContextAt(exit)).toMatchObject({ currentLabel: 'River valley' })
  })

  it('names every planned biome in the passenger context', () => {
    expect(routeContextAt(0)).toMatchObject({ currentLabel: 'Open fields' })
    expect(routeContextAt(ROUTE_SEGMENT_LENGTH)).toMatchObject({ currentLabel: 'Woodland' })
    expect(routeContextAt(ROUTE_SEGMENT_LENGTH * 2)).toMatchObject({ currentLabel: 'Town' })
    expect(routeContextAt(ROUTE_SEGMENT_LENGTH * 3)).toMatchObject({ currentLabel: 'River valley' })
    expect(routeContextAt(ROUTE_SEGMENT_LENGTH * 3 + RIVER_LAKE_OFFSET)).toMatchObject({ currentLabel: 'Lakeshore' })
    expect(routeContextAt(ROUTE_SEGMENT_LENGTH * 4)).toMatchObject({ currentLabel: 'Highlands' })
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
