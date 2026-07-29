import type { BiomeType } from './Biome'

/**
 * The route is the common source of truth for every feature that needs to
 * agree across streaming chunks. A beat is intentionally broader than a
 * biome: it explains the landscape, railway engineering, road relation and
 * future station type as one piece of railway geography.
 */
export const ROUTE_SEGMENT_LENGTH = 1500
export const ROUTE_BLEND_LENGTH = 350
export const DEFAULT_ROUTE_SEED = 0

/** Shared anchors for tunnel-adjacent road engineering. */
export const MOUNTAIN_TUNNEL_LENGTH = 280
export const MOUNTAIN_TUNNEL_OFFSET = ROUTE_SEGMENT_LENGTH * 0.72
/** Fixed infrastructure anchors inside every river-valley beat. */
export const RIVER_BRIDGE_OFFSET = 420
export const RIVER_VILLAGE_OFFSET = 700
/** A broad lakeshore opens after the bridge and village, before the climb. */
// Keep the lakeshore clear of the village envelope so the valley has a
// readable sequence: bridge, access village, then open water.
export const RIVER_LAKE_OFFSET = 1090
export const RIVER_LAKE_HALF_LENGTH = 120
export const RIVER_LAKE_FADE_LENGTH = 70
export const MIN_ROUTE_ANCHOR_SPACING = 90

export type RouteLandform = 'rolling' | 'woodland' | 'settlement' | 'valley' | 'mountain'
export type RailwayEngineering = 'open' | 'halt' | 'regional-station' | 'urban-through' | 'valley-bridge' | 'tunnel'
export type RoadRelation = 'none' | 'parallel' | 'station-access' | 'valley-access' | 'grade-separated'
export type SettlementFabric = 'none' | 'farmsteads' | 'village' | 'regional-town' | 'urban-edge'
export type StationKind = 'none' | 'rural-halt' | 'regional' | 'urban-through'
export type RouteAnchorKind = 'road-bridge' | 'river-village' | 'lakeshore' | 'tunnel'

export interface RouteFeature {
  biome: BiomeType
  /** 0..1 controls whether a road is surfaced and kept free of vegetation. */
  road: number
  /** Mountain sections are the only locations eligible for a tunnel. */
  tunnel: boolean
}

export interface RouteBeat extends RouteFeature {
  id: string
  landform: RouteLandform
  engineering: RailwayEngineering
  roadRelation: RoadRelation
  settlement: SettlementFabric
  station: StationKind
}

export interface RoutePlan {
  seed: number
  beats: readonly RouteBeat[]
}

export interface RouteAnchor {
  kind: RouteAnchorKind
  z: number
  /** The half-length of a visible feature, used for spacing validation. */
  halfLength: number
}

export interface RouteFeatureSample {
  current: RouteBeat
  next: RouteBeat
  segmentIndex: number
  segmentStart: number
  /** 0..1 only across the deliberate transition at the end of a segment. */
  blend: number
}

export interface RouteContext {
  currentLabel: string
  nextLabel: string
}

const BEATS = {
  'open-country': {
    id: 'open-country', biome: 'field', road: 0.3, tunnel: false,
    landform: 'rolling', engineering: 'open', roadRelation: 'parallel',
    settlement: 'farmsteads', station: 'none',
  },
  'rural-halt': {
    id: 'rural-halt', biome: 'field', road: 0.45, tunnel: false,
    landform: 'rolling', engineering: 'halt', roadRelation: 'station-access',
    settlement: 'village', station: 'rural-halt',
  },
  woodland: {
    id: 'woodland', biome: 'forest', road: 0.18, tunnel: false,
    landform: 'woodland', engineering: 'open', roadRelation: 'none',
    settlement: 'none', station: 'none',
  },
  'regional-town': {
    id: 'regional-town', biome: 'town', road: 1, tunnel: false,
    landform: 'settlement', engineering: 'regional-station', roadRelation: 'station-access',
    settlement: 'regional-town', station: 'regional',
  },
  'urban-edge': {
    id: 'urban-edge', biome: 'town', road: 1, tunnel: false,
    landform: 'settlement', engineering: 'urban-through', roadRelation: 'grade-separated',
    settlement: 'urban-edge', station: 'urban-through',
  },
  'river-valley': {
    id: 'river-valley', biome: 'river', road: 1, tunnel: false,
    landform: 'valley', engineering: 'valley-bridge', roadRelation: 'valley-access',
    settlement: 'village', station: 'none',
  },
  'mountain-pass': {
    id: 'mountain-pass', biome: 'mountain', road: 0.68, tunnel: true,
    landform: 'mountain', engineering: 'tunnel', roadRelation: 'parallel',
    settlement: 'none', station: 'none',
  },
} as const satisfies Record<string, RouteBeat>

type RouteBeatId = keyof typeof BEATS

// These are authored, coherent route programs rather than independent random
// biome rolls. Seed selection chooses a complete programme, so a valley bridge
// always has a valley and a mountain tunnel never appears in open farmland.
const CURATED_ROUTE_PROGRAMMES: readonly (readonly RouteBeatId[])[] = [
  // The default is deliberately long enough for a focus journey to encounter
  // every station scale before the river engineering and mountain exit.
  ['open-country', 'rural-halt', 'woodland', 'regional-town', 'urban-edge', 'river-valley', 'mountain-pass'],
  ['rural-halt', 'woodland', 'regional-town', 'river-valley', 'mountain-pass'],
  ['open-country', 'regional-town', 'woodland', 'river-valley', 'mountain-pass'],
  ['open-country', 'woodland', 'urban-edge', 'river-valley', 'mountain-pass'],
]

const BIOME_LABELS: Record<BiomeType, string> = {
  field: 'Open fields',
  forest: 'Woodland',
  town: 'Town',
  river: 'River valley',
  mountain: 'Highlands',
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

function normaliseSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) : DEFAULT_ROUTE_SEED
}

/** Create a deterministic, auto-curated route. The journey layer can provide
 * a new seed later without changing any streaming-world call site. */
export function createRoutePlan(seed = DEFAULT_ROUTE_SEED): RoutePlan {
  const normalisedSeed = normaliseSeed(seed)
  const programme = CURATED_ROUTE_PROGRAMMES[
    positiveModulo(normalisedSeed, CURATED_ROUTE_PROGRAMMES.length)
  ]
  return {
    seed: normalisedSeed,
    beats: programme.map((id) => BEATS[id]),
  }
}

export const DEFAULT_ROUTE_PLAN = createRoutePlan()

export function routeBeatForSegment(
  segmentIndex: number,
  plan: RoutePlan = DEFAULT_ROUTE_PLAN,
): RouteBeat {
  return plan.beats[positiveModulo(segmentIndex, plan.beats.length)]
}

/** Compatibility surface for existing terrain, weather and streaming systems. */
export function routeFeatureForSegment(segmentIndex: number): RouteFeature {
  return routeBeatForSegment(segmentIndex)
}

export function routeAnchorsForSegment(
  segmentIndex: number,
  plan: RoutePlan = DEFAULT_ROUTE_PLAN,
): RouteAnchor[] {
  const beat = routeBeatForSegment(segmentIndex, plan)
  const segmentStart = segmentIndex * ROUTE_SEGMENT_LENGTH

  if (beat.engineering === 'valley-bridge') {
    return [
      { kind: 'road-bridge', z: segmentStart + RIVER_BRIDGE_OFFSET, halfLength: 22 },
      { kind: 'river-village', z: segmentStart + RIVER_VILLAGE_OFFSET, halfLength: 110 },
      {
        kind: 'lakeshore',
        z: segmentStart + RIVER_LAKE_OFFSET,
        halfLength: RIVER_LAKE_HALF_LENGTH + RIVER_LAKE_FADE_LENGTH,
      },
    ]
  }

  if (beat.engineering === 'tunnel') {
    return [{ kind: 'tunnel', z: segmentStart + MOUNTAIN_TUNNEL_OFFSET, halfLength: MOUNTAIN_TUNNEL_LENGTH / 2 }]
  }

  return []
}

/** Returns human-readable violations to make authored route programmes testable. */
export function routeBeatIssues(beat: RouteBeat): string[] {
  const issues: string[] = []
  const valleyEngineering = beat.engineering === 'valley-bridge'
  const stationEngineering = ['halt', 'regional-station', 'urban-through'].includes(beat.engineering)

  if (beat.tunnel !== (beat.engineering === 'tunnel')) issues.push('tunnel flag must match tunnel engineering')
  if (beat.engineering === 'tunnel' && beat.landform !== 'mountain') issues.push('tunnels require mountain landform')
  if (valleyEngineering && beat.landform !== 'valley') issues.push('valley bridges require valley landform')
  if (valleyEngineering && beat.biome !== 'river') issues.push('valley bridges require river biome')
  if (beat.station === 'none' && stationEngineering) issues.push('station engineering requires a station kind')
  if (beat.station !== 'none' && !stationEngineering) issues.push('station kind requires station engineering')
  if (beat.station === 'rural-halt' && !['field', 'forest'].includes(beat.biome)) issues.push('rural halts require a rural biome')
  if (beat.station === 'regional' && beat.settlement !== 'regional-town') issues.push('regional stations require regional-town fabric')
  if (beat.station === 'urban-through' && beat.settlement !== 'urban-edge') issues.push('urban through stations require urban-edge fabric')
  if (beat.roadRelation === 'station-access' && beat.station === 'none') issues.push('station access roads require a station')
  if (beat.roadRelation === 'valley-access' && !valleyEngineering) issues.push('valley access roads require a valley bridge')

  return issues
}

export function routePlanIssues(plan: RoutePlan): string[] {
  const issues = plan.beats.flatMap((beat, index) =>
    routeBeatIssues(beat).map((issue) => `beat ${index}: ${issue}`),
  )
  const anchors = plan.beats.flatMap((_, segmentIndex) => routeAnchorsForSegment(segmentIndex, plan))
    .sort((a, b) => a.z - b.z)

  for (let index = 1; index < anchors.length; index++) {
    const previous = anchors[index - 1]
    const current = anchors[index]
    const separation = current.z - current.halfLength - (previous.z + previous.halfLength)
    if (separation < MIN_ROUTE_ANCHOR_SPACING) {
      issues.push(`${previous.kind} and ${current.kind} are too close`)
    }
  }

  return issues
}

export function sampleRouteFeature(z: number): RouteFeatureSample {
  const segmentIndex = Math.floor(z / ROUTE_SEGMENT_LENGTH)
  const segmentStart = segmentIndex * ROUTE_SEGMENT_LENGTH
  const blendStart = segmentStart + ROUTE_SEGMENT_LENGTH - ROUTE_BLEND_LENGTH
  const t = Math.min(Math.max((z - blendStart) / ROUTE_BLEND_LENGTH, 0), 1)
  const blend = t * t * (3 - 2 * t)

  return {
    current: routeBeatForSegment(segmentIndex),
    next: routeBeatForSegment(segmentIndex + 1),
    segmentIndex,
    segmentStart,
    blend,
  }
}

/**
 * 0..1 width factor for the planned lakeshore basin inside a river beat.
 * The plateau keeps the side-window view open long enough to read as a lake,
 * while the eased edges let the terrain and water ribbon meet continuously.
 */
export function lakeBasinStrengthAt(z: number): number {
  const segmentIndex = Math.floor(z / ROUTE_SEGMENT_LENGTH)
  const lake = routeAnchorsForSegment(segmentIndex).find((anchor) => anchor.kind === 'lakeshore')
  if (!lake) return 0

  const distance = Math.abs(z - lake.z)
  if (distance <= RIVER_LAKE_HALF_LENGTH) return 1
  if (distance >= lake.halfLength) return 0

  const t = (distance - RIVER_LAKE_HALF_LENGTH) / RIVER_LAKE_FADE_LENGTH
  return 1 - t * t * (3 - 2 * t)
}

/** Passenger-facing terrain context derived from the exact route coordinate
 * used by the camera and streamed scenery. */
export function routeContextAt(z: number): RouteContext {
  const route = sampleRouteFeature(z)
  const isLakeshore = lakeBasinStrengthAt(z) >= 0.12

  return {
    currentLabel: isLakeshore ? 'Lakeshore' : BIOME_LABELS[route.current.biome],
    nextLabel: BIOME_LABELS[route.next.biome],
  }
}
