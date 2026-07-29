import { describe, expect, it } from 'vitest'
import { cameraFovForAspect, compactViewportFactor } from './Camera'

describe('compact viewport camera', () => {
  it('keeps the authored field of view on desktop proportions', () => {
    expect(compactViewportFactor(16 / 9)).toBe(0)
    expect(cameraFovForAspect(16 / 9)).toBeCloseTo(70)
  })

  it('widens the real camera projection for a narrow portrait viewport', () => {
    expect(compactViewportFactor(393 / 852)).toBe(1)
    expect(cameraFovForAspect(393 / 852)).toBeCloseTo(90)
  })

  it('interpolates smoothly through tablet-sized aspect ratios', () => {
    expect(cameraFovForAspect(0.75)).toBeGreaterThan(70)
    expect(cameraFovForAspect(0.75)).toBeLessThan(90)
  })
})
