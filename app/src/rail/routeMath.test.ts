import { describe, expect, it } from 'vitest'
import { componentLength, longestComponent, validateGeometry } from './routeMath'

describe('rail geometry boundaries', () => {
  it('does not add a link across disconnected components', () => {
    const parts: [number, number][][] = [[[-74, 41], [-74, 42]], [[-120, 35], [-120, 36]]]
    expect(componentLength(parts[0])).toBeGreaterThan(110000)
    expect(componentLength(parts[0]) + componentLength(parts[1])).toBeLessThan(230000)
    expect(longestComponent(parts)).toBe(0)
  })
  it('rejects missing or nonfinite coordinates before starting a ride', () => {
    expect(() => validateGeometry({ components: [[[NaN, 0], [1, 2]]] })).toThrow()
    expect(() => validateGeometry({ components: [[[181, 0], [1, 2]]] })).toThrow()
    expect(() => validateGeometry({ components: [[[1, 2]]] })).toThrow()
  })
  it('keeps component boundaries and supports a single continuous component', () => {
    const parts = [[[-74, 41], [-73.9, 41.1]], [[-120, 35], [-120, 35.2]]]
    expect(validateGeometry({ components: parts })).toHaveLength(2)
    expect(longestComponent(validateGeometry({ components: parts }))).toBe(1)
  })
})
