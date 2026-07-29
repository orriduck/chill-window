import type { SettlementFabric } from './RouteFeatures'

export type TownProfile = 'regional' | 'urban'

export function townProfileForSettlement(fabric: SettlementFabric): TownProfile | null {
  if (fabric === 'regional-town') return 'regional'
  if (fabric === 'urban-edge') return 'urban'
  return null
}
