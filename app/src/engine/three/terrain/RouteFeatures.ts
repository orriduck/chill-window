import type { BiomeType } from './Biome'

/**
 * The route is the common source of truth for every feature that needs to
 * agree across streaming chunks: terrain type, a visible parallel road, and
 * the larger railway engineering works.  Values are deterministic in world
 * coordinates, so entering a pre-warmed chunk cannot reshuffle the scene.
 */
export const ROUTE_SEGMENT_LENGTH = 1500
export const ROUTE_BLEND_LENGTH = 350

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
  { biome: 'mountain', road: 0.08, tunnel: true },
]

export interface RouteFeatureSample {
  current: RouteFeature
  next: RouteFeature
  segmentIndex: number
  segmentStart: number
  /** 0..1 only across the deliberate transition at the end of a segment. */
  blend: number
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
