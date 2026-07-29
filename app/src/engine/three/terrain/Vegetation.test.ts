import { describe, expect, it } from 'vitest'
import { TREE_STYLES, treeSpriteCell, treeSpriteVariantCount, treeStyleForBiome } from './Vegetation'

describe('treeStyleForBiome', () => {
  it('keeps every requested tree silhouette reachable through deterministic samples', () => {
    const seen = new Set<string>()
    for (const biome of ['field', 'forest', 'mountain', 'river', 'town'] as const) {
      for (let i = 0; i <= 100; i++) seen.add(treeStyleForBiome(biome, i / 100))
    }
    expect([...seen].sort()).toEqual([...TREE_STYLES].sort())
  })

  it('gives mountain and river sections their expected dominant silhouettes', () => {
    expect(treeStyleForBiome('mountain', 0.2)).toBe('pine')
    expect(treeStyleForBiome('river', 0.2)).toBe('willow')
    expect(treeStyleForBiome('forest', 0.96)).toBe('bare')
  })

  it('clamps unstable random values to a deterministic result', () => {
    expect(treeStyleForBiome('field', -1)).toBe(treeStyleForBiome('field', 0))
    expect(treeStyleForBiome('field', 2)).toBe(treeStyleForBiome('field', 1))
  })
})

describe('tree sprite atlas cells', () => {
  it('keeps vertically stacked near-tree cells separate', () => {
    expect(treeSpriteVariantCount('near')).toBe(8)
    expect(treeSpriteCell('near', 0)).toMatchObject({ col: 0, row: 0, columns: 4, rows: 2 })
    expect(treeSpriteCell('near', 4)).toMatchObject({ col: 0, row: 1, columns: 4, rows: 2 })
  })

  it('uses the independent 2x2 far-tree atlas layout', () => {
    expect(treeSpriteVariantCount('far')).toBe(4)
    expect(treeSpriteCell('far', 3)).toMatchObject({ col: 1, row: 1, columns: 2, rows: 2 })
  })

  it('clamps invalid atlas variants into a real cell', () => {
    expect(treeSpriteCell('far', -1)).toMatchObject({ col: 0, row: 0 })
    expect(treeSpriteCell('near', 12)).toMatchObject({ col: 3, row: 1 })
  })
})
