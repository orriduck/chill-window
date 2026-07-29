import { describe, expect, it } from 'vitest'
import { rainDropFallSpeed } from './WindowFrame'

describe('rainDropFallSpeed', () => {
  it('keeps rain slow while stopped and increases streak motion at cruise', () => {
    expect(rainDropFallSpeed(0)).toBeCloseTo(0.14)
    expect(rainDropFallSpeed(1)).toBeCloseTo(0.89)
    expect(rainDropFallSpeed(1)).toBeGreaterThan(rainDropFallSpeed(0))
  })

  it('clamps invalid speed telemetry to the supported range', () => {
    expect(rainDropFallSpeed(-1)).toBeCloseTo(rainDropFallSpeed(0))
    expect(rainDropFallSpeed(2)).toBeCloseTo(rainDropFallSpeed(1))
  })
})
