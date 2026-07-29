import { describe, expect, it } from 'vitest'
import { stationDistrictLayout, stationNightLightLevel } from './Station'

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

describe('stationDistrictLayout', () => {
  it('keeps the taxi forecourt and station hall clear of the access road', () => {
    const layout = stationDistrictLayout(20)

    expect(layout.forecourtWidth).toBeGreaterThan(0)
    expect(layout.forecourtCenterX + layout.forecourtWidth / 2).toBeLessThan(layout.roadMinX)
    expect(layout.hallCenterX - 10.5 / 2).toBeGreaterThan(layout.roadMaxX)
    expect(layout.taxiBayX).toBeLessThan(layout.roadMinX)
    expect(layout.shelterX).toBeLessThan(layout.roadMinX)
  })
})
