import { describe, expect, it } from 'vitest'
import {
  stationDistrictLayout,
  stationHallFacadeLayout,
  stationNightLightLevel,
  stationVisualKindAt,
  urbanPassingTrackCenters,
} from './Station'
import { createRoutePlan } from '../terrain/RouteFeatures'

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

describe('stationHallFacadeLayout', () => {
  it('keeps the entry sequence in front of the facade and clear of window bays', () => {
    const layout = stationHallFacadeLayout()

    expect(layout.porticoX).toBeLessThan(layout.frontX)
    expect(layout.stepX).toBeLessThan(layout.porticoX)
    expect(layout.eaveY).toBeGreaterThan(4.6)
    expect(layout.ridgeY).toBeGreaterThan(layout.eaveY)
    expect(layout.windowCenters.every((center) => Math.abs(center) > layout.entranceWidth / 2)).toBe(true)
  })
})

describe('station route typology', () => {
  it('maps route beats to visible station types without leaving an untyped stop', () => {
    expect(stationVisualKindAt(0)).toBe('rural-halt')
    expect(stationVisualKindAt(3 * 1500)).toBe('regional')
    expect(stationVisualKindAt(2 * 1500, createRoutePlan(3))).toBe('urban-through')
  })
})

describe('urban station track capacity', () => {
  it('keeps each visible through line on a distinct turnout alignment', () => {
    const centers = urbanPassingTrackCenters()
    expect(centers).toEqual([-4.4, -7.5])
    expect(Math.abs(centers[0] - centers[1])).toBeGreaterThan(3)
  })
})
