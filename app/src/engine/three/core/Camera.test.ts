import { describe, expect, it } from 'vitest'
import {
  cameraFovForAspect,
  compactViewportFactor,
  CRUISE_SPEED,
  TrainCamera,
  cruiseSpeedForScheduledStop,
  MAX_PASSENGER_VIEW_YAW,
} from './Camera'

describe('compact viewport camera', () => {
  it('keeps the authored field of view on desktop proportions', () => {
    expect(compactViewportFactor(16 / 9)).toBe(0)
    expect(cameraFovForAspect(16 / 9)).toBeCloseTo(70)
  })

  it('widens the real camera projection for a narrow portrait viewport without shrinking the window away', () => {
    expect(compactViewportFactor(393 / 852)).toBe(1)
    expect(cameraFovForAspect(393 / 852)).toBeCloseTo(72)
  })

  it('interpolates smoothly through tablet-sized aspect ratios', () => {
    expect(cameraFovForAspect(0.75)).toBeGreaterThan(70)
    expect(cameraFovForAspect(0.75)).toBeLessThan(72)
  })
})

describe('scheduled station cruise speed', () => {
  it('tracks authored stop distance while keeping a restrained speed envelope', () => {
    expect(cruiseSpeedForScheduledStop(CRUISE_SPEED * 600, 600)).toBeCloseTo(CRUISE_SPEED)
    expect(cruiseSpeedForScheduledStop(1, 600)).toBeCloseTo(CRUISE_SPEED * 0.65)
    expect(cruiseSpeedForScheduledStop(100000, 60)).toBeCloseTo(CRUISE_SPEED)
  })
})

describe('passenger coach view range', () => {
  it('permits inspection of neighbouring bays without a full turn away from the window', () => {
    expect(MAX_PASSENGER_VIEW_YAW).toBeCloseTo(0.65)
    expect(MAX_PASSENGER_VIEW_YAW).toBeLessThan(Math.PI / 4)
  })
})


describe('physical mainline motion', () => {
  it('travels 444.4 metres in ten seconds at 160 km/h and freezes while paused', () => {
    const train = new TrainCamera()
    train.setZ(1000)
    train.setTargetSpeed(CRUISE_SPEED)
    train.currentSpeed = CRUISE_SPEED
    for (let i = 0; i < 600; i++) train.update(1 / 60)
    expect(train.z - 1000).toBeCloseTo(160 / 3.6 * 10, 5)
    const stopped = train.z
    train.update(1, false)
    expect(train.z).toBe(stopped)
  })

  it('brakes from 160 km/h to the platform without overshooting', () => {
    const train = new TrainCamera()
    train.setZ(2000)
    train.currentSpeed = CRUISE_SPEED
    const stop = train.z + TrainCamera.STATION_STOP_DISTANCE
    train.beginStationApproach(stop)
    for (let i = 0; i < 60 * 60; i++) {
      train.update(1 / 60)
      expect(train.z).toBeLessThanOrEqual(stop)
    }
    expect(train.currentSpeed).toBe(0)
    expect(train.z).toBeCloseTo(stop, 1)
  })
})


it('keeps distance proportional to time through ordinary long rendering frames', () => {
  const train = new TrainCamera()
  train.currentSpeed = CRUISE_SPEED
  train.setTargetSpeed(CRUISE_SPEED)
  const start = train.z
  const frames = [0.016, 0.24, 0.033, 0.31, 0.016, 0.18]
  for (const dt of frames) train.update(dt)
  expect(train.z - start).toBeCloseTo(frames.reduce((a, b) => a + b, 0) * CRUISE_SPEED, 6)
})
