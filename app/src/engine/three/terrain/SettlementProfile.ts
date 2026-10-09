import type { SettlementFabric } from './RouteFeatures'

export type TownProfile = 'regional' | 'urban' | 'village' | 'metro'

export function townProfileForSettlement(fabric: SettlementFabric): TownProfile | null {
  if (fabric === 'village') return 'village'
  if (fabric === 'city-core') return 'metro'
  if (fabric === 'regional-town') return 'regional'
  if (fabric === 'urban-edge') return 'urban'
  return null
}
