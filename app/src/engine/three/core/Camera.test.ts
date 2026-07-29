import { describe, expect, it } from 'vitest'
import { cameraFovForAspect, compactViewportFactor, CRUISE_SPEED, cruiseSpeedForScheduledStop } from './Camera'

describe('compact viewport camera', () => {
  it('keeps the authored field of view on desktop proportions', () => {
    expect(compactViewportFactor(16 / 9)).toBe(0)
    expect(cameraFovForAspect(16 / 9)).toBeCloseTo(70)
  })

  it('widens the real camera projection for a narrow portrait viewport without shrinking the window away', () => {
    expect(compactViewportFactor(393 / 852)).toBe(1)
    expect(cameraFovForAspect(393 / 852)).toBeCloseTo(78)
  })

  it('interpolates smoothly through tablet-sized aspect ratios', () => {
    expect(cameraFovForAspect(0.75)).toBeGreaterThan(70)
    expect(cameraFovForAspect(0.75)).toBeLessThan(78)
  })
})

describe('scheduled station cruise speed', () => {
  it('tracks authored stop distance while keeping a restrained speed envelope', () => {
    expect(cruiseSpeedForScheduledStop(CRUISE_SPEED * 600, 600)).toBeCloseTo(CRUISE_SPEED)
    expect(cruiseSpeedForScheduledStop(1, 600)).toBeCloseTo(CRUISE_SPEED * 0.65)
    expect(cruiseSpeedForScheduledStop(100000, 60)).toBeCloseTo(CRUISE_SPEED * 1.25)
  })
})
