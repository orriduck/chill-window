import { describe, expect, it } from 'vitest'
import { isTownPlannedFootprint } from './TownGenerator'

describe('town planned footprint', () => {
  const centerX = 20
  const centerZ = 900

  it('covers the main street, side streets, and building lots', () => {
    expect(isTownPlannedFootprint(centerX, centerZ, centerX, centerZ)).toBe(true)
    expect(isTownPlannedFootprint(centerX + 34, centerZ + 54, centerX, centerZ)).toBe(true)
    expect(isTownPlannedFootprint(centerX + 44, centerZ + 100, centerX, centerZ)).toBe(true)
  })

  it('leaves the rail verge and open countryside available to natural foliage', () => {
    expect(isTownPlannedFootprint(centerX - 4.1, centerZ, centerX, centerZ)).toBe(false)
    expect(isTownPlannedFootprint(centerX + 44.1, centerZ, centerX, centerZ)).toBe(false)
    expect(isTownPlannedFootprint(centerX + 20, centerZ + 100.1, centerX, centerZ)).toBe(false)
  })

  it('reserves a broader, longer envelope for an urban-edge district', () => {
    expect(isTownPlannedFootprint(centerX + 54, centerZ + 112, centerX, centerZ, 'urban')).toBe(true)
    expect(isTownPlannedFootprint(centerX + 54, centerZ + 112, centerX, centerZ, 'regional')).toBe(false)
  })
})
