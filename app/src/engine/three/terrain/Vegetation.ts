import type { BiomeType } from './Biome'

export const TREE_STYLES = ['round', 'pine', 'willow', 'bare', 'cluster'] as const
export type TreeStyle = (typeof TREE_STYLES)[number]
export type TreeSpriteDistance = 'near' | 'far'

const TREE_ATLAS = {
  near: { columns: 4, rows: 2 },
  far: { columns: 2, rows: 2 },
} as const

export function treeSpriteVariantCount(distance: TreeSpriteDistance): number {
  const atlas = TREE_ATLAS[distance]
  return atlas.columns * atlas.rows
}

/** Resolve an atlas cell without allowing the vertically stacked source trees
 * to be sampled by the same billboard. */
export function treeSpriteCell(distance: TreeSpriteDistance, variant: number) {
  const atlas = TREE_ATLAS[distance]
  const count = treeSpriteVariantCount(distance)
  const safeVariant = Math.min(Math.max(Math.floor(variant), 0), count - 1)
  return {
    col: safeVariant % atlas.columns,
    row: Math.floor(safeVariant / atlas.columns),
    columns: atlas.columns,
    rows: atlas.rows,
  }
}

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
