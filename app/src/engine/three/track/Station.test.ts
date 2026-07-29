import { describe, expect, it } from 'vitest'
import { stationNightLightLevel } from './Station'

describe('stationNightLightLevel', () => {
  it('keeps platform lighting restrained by day and readable at night', () => {
    expect(stationNightLightLevel(0.45)).toBeCloseTo(0.12)
    expect(stationNightLightLevel(0.24)).toBeGreaterThan(0.8)
    expect(stationNightLightLevel(0.24)).toBeGreaterThan(stationNightLightLevel(0.3))
  })

  it('clamps extreme ambient values into the supported lighting range', () => {
    expect(stationNightLightLevel(-1)).toBeCloseTo(1)
    expect(stationNightLightLevel(2)).toBeCloseTo(0.12)
  })
})
