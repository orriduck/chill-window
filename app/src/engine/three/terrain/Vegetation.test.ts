import { describe, expect, it } from 'vitest'
import { TREE_STYLES, treeStyleForBiome } from './Vegetation'

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
