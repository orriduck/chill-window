import { getBiomeConfig, type HeightParams } from './Biome'
import { sampleRouteFeature, type RouteBeat, type RoutePlan } from './RouteFeatures'

export function landscapeParams(beat: RouteBeat, continuous = false): HeightParams {
  const params = { ...getBiomeConfig(beat.biome).heightParams, road: beat.road }
  if (!continuous) return params
  params.farmland = beat.id === 'open-country' || beat.id === 'rural-halt' ? 1 : 0
  if (beat.landform === 'plain' || beat.landform === 'settlement') {
    params.amplitude = 0.45
    params.frequency = 0.004
    params.baseHeight = -0.25
  }
  if (beat.landform === 'woodland') {
    params.amplitude = 3
    params.frequency = 0.004
    params.persistence = 0.38
    params.octaves = 3
  }
  if (beat.landform === 'foothills') {
    params.amplitude = 3
    params.frequency = 0.006
    params.ridge = 0.35
  }
  if (beat.landform === 'mountain') {
    params.amplitude = 10
    params.frequency = 0.004
    params.ridge = 1
  }
  if (beat.landform === 'valley') {
    params.amplitude = 0.7
    params.valley = 1
  }
  return params
}

export function landscapeAt(z: number, plan: RoutePlan) {
  const route = sampleRouteFeature(z, plan)
  const from = getBiomeConfig(route.current.biome)
  const to = getBiomeConfig(route.next.biome)
  const a = landscapeParams(route.current, plan.continuous)
  const b = landscapeParams(route.next, plan.continuous)
  const t = route.blend
  const mix = (x = 0, y = 0) => x + (y - x) * t
  const params: HeightParams = {
    ...a, naturalSource: a,
    baseHeight: mix(a.baseHeight, b.baseHeight), amplitude: mix(a.amplitude, b.amplitude),
    blendTarget: t > 0 ? b : undefined, blendWeight: t,
    river: mix(a.river, b.river), road: mix(a.road, b.road), farmland: mix(a.farmland, b.farmland),
  }
  const lowland = (beat: RouteBeat) => ['plain', 'rolling', 'settlement'].includes(beat.landform) ? 1 : 0
  return { route, from, to, params, lowland: mix(lowland(route.current), lowland(route.next)) }
}
