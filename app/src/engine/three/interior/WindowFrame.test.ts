import { describe, expect, it } from 'vitest'
import {
  clampWindowHudProgress,
  glassReflectionOpacity,
  rainDropFallSpeed,
  rainDropInitialY,
  windowHudSurfaceLayout,
} from './WindowFrame'

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

  it('spawns foreground rain inside the glass aperture', () => {
    expect(rainDropInitialY(0)).toBeCloseTo(-1.4)
    expect(rainDropInitialY(1)).toBeCloseTo(1.4)
    expect(rainDropInitialY(-1)).toBeCloseTo(rainDropInitialY(0))
    expect(rainDropInitialY(2)).toBeCloseTo(rainDropInitialY(1))
  })
})

describe('glassReflectionOpacity', () => {
  it('keeps reflections subtle in daylight and more readable at night', () => {
    expect(glassReflectionOpacity(0.45)).toBeCloseTo(0.028)
    expect(glassReflectionOpacity(0.18)).toBeGreaterThan(glassReflectionOpacity(0.45))
    expect(glassReflectionOpacity(0.18)).toBeLessThan(0.12)
  })

  it('clamps lighting values outside the supported range', () => {
    expect(glassReflectionOpacity(-1)).toBeCloseTo(glassReflectionOpacity(0))
    expect(glassReflectionOpacity(2)).toBeCloseTo(glassReflectionOpacity(0.45))
  })
})

describe('window HUD surfaces', () => {
  it('keeps both physical rails within the glazed opening', () => {
    const layout = windowHudSurfaceLayout()

    expect(layout.bottom.y - layout.bottom.height / 2).toBeGreaterThan(-1.45)
    expect(layout.bottom.y + layout.bottom.height / 2).toBeLessThan(1.45)
    expect(layout.top.y - layout.top.height / 2).toBeGreaterThan(-1.45)
    expect(layout.top.y + layout.top.height / 2).toBeLessThan(1.45)
  })

  it('clamps physical progress to the drawable rail', () => {
    expect(clampWindowHudProgress(-0.2)).toBe(0)
    expect(clampWindowHudProgress(0.36)).toBeCloseTo(0.36)
    expect(clampWindowHudProgress(1.2)).toBe(1)
  })
})
