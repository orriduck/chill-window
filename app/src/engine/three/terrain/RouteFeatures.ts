import type { BiomeType } from './Biome'

/**
 * The route is the common source of truth for every feature that needs to
 * agree across streaming chunks: terrain type, a visible parallel road, and
 * the larger railway engineering works.  Values are deterministic in world
 * coordinates, so entering a pre-warmed chunk cannot reshuffle the scene.
 */
export const ROUTE_SEGMENT_LENGTH = 1500
export const ROUTE_BLEND_LENGTH = 350
/** Shared anchors for tunnel-adjacent road engineering. */
export const MOUNTAIN_TUNNEL_LENGTH = 280
export const MOUNTAIN_TUNNEL_OFFSET = ROUTE_SEGMENT_LENGTH * 0.72
/** Fixed infrastructure anchors inside every river segment. */
export const RIVER_BRIDGE_OFFSET = 420
export const RIVER_VILLAGE_OFFSET = 700
/** A broad lakeshore opens after the bridge and village, before the climb. */
export const RIVER_LAKE_OFFSET = 950
export const RIVER_LAKE_HALF_LENGTH = 120
export const RIVER_LAKE_FADE_LENGTH = 70

export interface RouteFeature {
  biome: BiomeType
  /** 0..1 controls whether a road is surfaced and kept free of vegetation. */
  road: number
  /** Mountain sections are the only locations eligible for a tunnel. */
  tunnel: boolean
}

const ROUTE_FEATURES: readonly RouteFeature[] = [
  { biome: 'field', road: 0.3, tunnel: false },
  { biome: 'forest', road: 0.18, tunnel: false },
  { biome: 'town', road: 1, tunnel: false },
  { biome: 'river', road: 1, tunnel: false },
  // A maintained mountain service road is deliberately less finished than
  // town asphalt, but prominent enough to establish the approach before the
  // railway disappears into the tunnel.
  { biome: 'mountain', road: 0.68, tunnel: true },
]

export interface RouteFeatureSample {
  current: RouteFeature
  next: RouteFeature
  segmentIndex: number
  segmentStart: number
  /** 0..1 only across the deliberate transition at the end of a segment. */
  blend: number
}

export interface RouteContext {
  currentLabel: string
  nextLabel: string
}

const BIOME_LABELS: Record<BiomeType, string> = {
  field: '田野',
  forest: '林地',
  town: '城镇',
  river: '河谷',
  mountain: '山地',
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

export function routeFeatureForSegment(segmentIndex: number): RouteFeature {
  return ROUTE_FEATURES[positiveModulo(segmentIndex, ROUTE_FEATURES.length)]
}

export function sampleRouteFeature(z: number): RouteFeatureSample {
  const segmentIndex = Math.floor(z / ROUTE_SEGMENT_LENGTH)
  const segmentStart = segmentIndex * ROUTE_SEGMENT_LENGTH
  const blendStart = segmentStart + ROUTE_SEGMENT_LENGTH - ROUTE_BLEND_LENGTH
  const t = Math.min(Math.max((z - blendStart) / ROUTE_BLEND_LENGTH, 0), 1)
  const blend = t * t * (3 - 2 * t)

  return {
    current: routeFeatureForSegment(segmentIndex),
    next: routeFeatureForSegment(segmentIndex + 1),
    segmentIndex,
    segmentStart,
    blend,
  }
}

/**
 * 0..1 width factor for the planned lakeshore basin inside a river segment.
 * The plateau keeps the side-window view open long enough to read as a lake,
 * while the eased edges let the terrain and water ribbon meet continuously.
 */
export function lakeBasinStrengthAt(z: number): number {
  const segmentIndex = Math.floor(z / ROUTE_SEGMENT_LENGTH)
  if (routeFeatureForSegment(segmentIndex).biome !== 'river') return 0

  const center = segmentIndex * ROUTE_SEGMENT_LENGTH + RIVER_LAKE_OFFSET
  const distance = Math.abs(z - center)
  if (distance <= RIVER_LAKE_HALF_LENGTH) return 1
  if (distance >= RIVER_LAKE_HALF_LENGTH + RIVER_LAKE_FADE_LENGTH) return 0

  const t = (distance - RIVER_LAKE_HALF_LENGTH) / RIVER_LAKE_FADE_LENGTH
  return 1 - t * t * (3 - 2 * t)
}

/**
 * Passenger-facing terrain context derived from the exact route coordinate
 * used by the camera and streamed scenery. The low threshold makes the lake
 * label enter a little before the full-width basin, but it remains entirely
 * deterministic while the train crosses either eased shore.
 */
export function routeContextAt(z: number): RouteContext {
  const route = sampleRouteFeature(z)
  const isLakeshore = lakeBasinStrengthAt(z) >= 0.12

  return {
    currentLabel: isLakeshore ? '湖岸' : BIOME_LABELS[route.current.biome],
    nextLabel: BIOME_LABELS[route.next.biome],
  }
}
