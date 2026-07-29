import type { BiomeType } from './Biome'

export const TREE_STYLES = ['round', 'pine', 'willow', 'bare', 'cluster'] as const
export type TreeStyle = (typeof TREE_STYLES)[number]

function unit(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

/**
 * Deterministic tree taxonomy for the route. The selection is independent of
 * chunk creation order, while each biome retains a recognisable silhouette.
 */
export function treeStyleForBiome(biome: BiomeType, randomValue: number): TreeStyle {
  const t = unit(randomValue)
  switch (biome) {
    case 'mountain':
      if (t < 0.66) return 'pine'
      if (t < 0.82) return 'bare'
      if (t < 0.92) return 'cluster'
      return 'round'
    case 'river':
      if (t < 0.5) return 'willow'
      if (t < 0.73) return 'cluster'
      if (t < 0.9) return 'round'
      return 'pine'
    case 'forest':
      if (t < 0.28) return 'pine'
      if (t < 0.54) return 'round'
      if (t < 0.68) return 'willow'
      if (t < 0.9) return 'cluster'
      return 'bare'
    case 'town':
      if (t < 0.46) return 'round'
      if (t < 0.66) return 'cluster'
      if (t < 0.82) return 'willow'
      if (t < 0.94) return 'pine'
      return 'bare'
    case 'field':
    default:
      if (t < 0.45) return 'round'
      if (t < 0.72) return 'cluster'
      if (t < 0.84) return 'pine'
      if (t < 0.95) return 'willow'
      return 'bare'
  }
}
