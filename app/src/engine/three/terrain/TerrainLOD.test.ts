import { describe, expect, it } from 'vitest'
import { DECORATION_EDGE_CLEARANCE, isDecorationInsideChunk } from './DecorationPlacement'

describe('streamed decoration ownership', () => {
  it('keeps large props out of independently generated chunk seams', () => {
    expect(isDecorationInsideChunk(128, 128, 0, 0)).toBe(true)
    expect(isDecorationInsideChunk(DECORATION_EDGE_CLEARANCE - 0.01, 128, 0, 0)).toBe(false)
    expect(isDecorationInsideChunk(256 - DECORATION_EDGE_CLEARANCE + 0.01, 128, 0, 0)).toBe(false)
    expect(isDecorationInsideChunk(128, DECORATION_EDGE_CLEARANCE - 0.01, 0, 0)).toBe(false)
  })
})
