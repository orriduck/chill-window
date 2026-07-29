import { describe, expect, it } from 'vitest'
import {
  glassReflectionOpacity,
  projectedWindowEdgeAngleDeg,
  rainDropFallSpeed,
  rainDropInitialY,
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

describe('projectedWindowEdgeAngleDeg', () => {
  it('converts NDC y-up coordinates to a clockwise DOM slope', () => {
    expect(projectedWindowEdgeAngleDeg({ x: -0.8, y: 0.1 }, { x: 0.8, y: -0.1 })).toBeCloseTo(7.13, 1)
  })

  it('keeps a level window rail level and clamps extreme perspective', () => {
    expect(projectedWindowEdgeAngleDeg({ x: -0.8, y: 0.1 }, { x: 0.8, y: 0.1 })).toBeCloseTo(0)
    expect(projectedWindowEdgeAngleDeg({ x: -0.8, y: 0.9 }, { x: 0.8, y: -0.9 })).toBe(12)
  })

  it('falls back to level when projection reverses the edge', () => {
    expect(projectedWindowEdgeAngleDeg({ x: 0.2, y: 0 }, { x: 0.1, y: 0.2 })).toBe(0)
  })
})
