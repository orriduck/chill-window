import { describe, expect, it } from 'vitest'
import { waterRippleOffset } from './WaterSystem'

describe('waterRippleOffset', () => {
  it('keeps the animated ripple phase inside the repeat interval', () => {
    expect(waterRippleOffset(0, 0)).toBe(0)
    expect(waterRippleOffset(17, 6400)).toBeGreaterThanOrEqual(0)
    expect(waterRippleOffset(17, 6400)).toBeLessThan(1)
    expect(waterRippleOffset(22, -1200)).toBeGreaterThanOrEqual(0)
    expect(waterRippleOffset(22, -1200)).toBeLessThan(1)
  })

  it('changes phase with both train position and water flow time', () => {
    expect(waterRippleOffset(0, 100)).not.toBe(waterRippleOffset(0, 160))
    expect(waterRippleOffset(0, 100)).not.toBe(waterRippleOffset(20, 100))
  })
})
