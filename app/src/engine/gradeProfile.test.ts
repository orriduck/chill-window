import { describe, expect, it } from 'vitest'
import { gradeProfileAngleDeg } from './gradeProfile'

describe('gradeProfileAngleDeg', () => {
  it('keeps level track horizontal', () => {
    expect(gradeProfileAngleDeg(0)).toBe(0)
  })

  it('tilts upward for climbs and downward for descents', () => {
    expect(gradeProfileAngleDeg(0.006)).toBeLessThan(0)
    expect(gradeProfileAngleDeg(-0.006)).toBeGreaterThan(0)
  })

  it('caps extreme values to a compact HUD range', () => {
    expect(gradeProfileAngleDeg(1)).toBeCloseTo(gradeProfileAngleDeg(0.02))
    expect(gradeProfileAngleDeg(-1)).toBeCloseTo(gradeProfileAngleDeg(-0.02))
  })
})
