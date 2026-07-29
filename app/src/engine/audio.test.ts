import { describe, expect, it } from 'vitest'
import { trainSoundMix } from './audio'

describe('trainSoundMix', () => {
  it('is quiet while stopped', () => {
    const mix = trainSoundMix({ speedRatio: 0, acceleration: 0 })

    expect(mix.tractionGain).toBe(0)
    expect(mix.brakeGain).toBe(0)
    expect(mix.railGain).toBe(0)
  })

  it('brings traction forward while accelerating', () => {
    const mix = trainSoundMix({ speedRatio: 0.55, acceleration: 2.2 })

    expect(mix.tractionGain).toBeGreaterThan(0)
    expect(mix.brakeGain).toBe(0)
    expect(mix.tractionHz).toBeGreaterThan(46)
  })

  it('adds braking texture only while physically slowing down', () => {
    const braking = trainSoundMix({ speedRatio: 0.7, acceleration: -3 })
    const cruising = trainSoundMix({ speedRatio: 0.7, acceleration: 0 })

    expect(braking.brakeGain).toBeGreaterThan(0)
    expect(cruising.brakeGain).toBe(0)
    expect(braking.rollingGain).toBeCloseTo(cruising.rollingGain)
  })

  it('shortens rail-joint intervals as speed builds', () => {
    expect(trainSoundMix({ speedRatio: 1, acceleration: 0 }).railInterval)
      .toBeLessThan(trainSoundMix({ speedRatio: 0.2, acceleration: 0 }).railInterval)
  })

  it('adds restrained pneumatic pulses only while decelerating', () => {
    const coasting = trainSoundMix({ speedRatio: 0.8, acceleration: 0 })
    const braking = trainSoundMix({ speedRatio: 0.8, acceleration: -3.5 })

    expect(coasting.brakePulseGain).toBe(0)
    expect(braking.brakePulseGain).toBeGreaterThan(0)
    expect(braking.brakePulseInterval).toBeLessThan(coasting.brakePulseInterval)
  })
})
