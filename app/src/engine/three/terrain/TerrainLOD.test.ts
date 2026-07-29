import { describe, expect, it } from 'vitest'
import { DECORATION_EDGE_CLEARANCE, isDecorationInsideChunk } from './DecorationPlacement'
import { grassWindProfile } from './VegetationWind'

describe('streamed decoration ownership', () => {
  it('keeps large props out of independently generated chunk seams', () => {
    expect(isDecorationInsideChunk(128, 128, 0, 0)).toBe(true)
    expect(isDecorationInsideChunk(DECORATION_EDGE_CLEARANCE - 0.01, 128, 0, 0)).toBe(false)
    expect(isDecorationInsideChunk(256 - DECORATION_EDGE_CLEARANCE + 0.01, 128, 0, 0)).toBe(false)
    expect(isDecorationInsideChunk(128, DECORATION_EDGE_CLEARANCE - 0.01, 0, 0)).toBe(false)
  })
})

describe('near grass wind profile', () => {
  it('keeps sprite roots planted and concentrates movement at the tips', () => {
    expect(grassWindProfile(0)).toBe(0)
    expect(grassWindProfile(0.5)).toBeCloseTo(0.25)
    expect(grassWindProfile(1)).toBe(1)
  })

  it('clamps malformed authored heights before applying wind', () => {
    expect(grassWindProfile(-1)).toBe(0)
    expect(grassWindProfile(2)).toBe(1)
  })
})
