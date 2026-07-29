import { describe, expect, it } from 'vitest'
import {
  clampWindowHudProgress,
  coachCabinLayout,
  glassReflectionOpacity,
  rainDropFallSpeed,
  rainDropInitialY,
  windowFrameViewportLayout,
  windowHudControlCanvasRects,
  windowHudControlLayout,
  windowBayLayout,
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
    expect(rainDropInitialY(0)).toBeCloseTo(-1.375)
    expect(rainDropInitialY(1)).toBeCloseTo(1.375)
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
  it('keeps the consolidated physical rail within the glazed opening', () => {
    const layout = windowHudSurfaceLayout()

    expect(layout.rail.y - layout.rail.height / 2).toBeGreaterThan(-1.1)
    expect(layout.rail.y + layout.rail.height / 2).toBeLessThan(1.8)
    expect(layout.rail.y).toBeLessThan(-0.55)
    expect(layout.rail.height).toBeLessThan(0.6)
  })

  it('reserves one compact right-side strip for the canvas-painted controls', () => {
    const controls = windowHudControlLayout()
    const stripWidth = controls.size * 5 + controls.gap * 4

    expect(stripWidth + controls.rightInset).toBeLessThan(1280)
    expect(controls.topInset + controls.size).toBeLessThan(104)
  })

  it('keeps every projected control source rect inside the HUD with clear gaps', () => {
    const rects = windowHudControlCanvasRects()

    expect(rects).toHaveLength(5)
    expect(rects[0].x).toBeGreaterThan(0)
    expect(rects[4].x + rects[4].width).toBeLessThan(1280)
    expect(rects[4].y + rects[4].height).toBeLessThan(104)
    expect(rects[1].x).toBeGreaterThan(rects[0].x + rects[0].width)
  })

  it('clamps physical progress to the drawable rail', () => {
    expect(clampWindowHudProgress(-0.2)).toBe(0)
    expect(clampWindowHudProgress(0.36)).toBeCloseTo(0.36)
    expect(clampWindowHudProgress(1.2)).toBe(1)
  })
})

describe('window frame viewport layout', () => {
  it('keeps the desktop cabin at its authored scale', () => {
    const layout = windowFrameViewportLayout(16 / 9)

    expect(layout.frameDistance).toBeCloseTo(3.1)
    expect(layout.scale).toBeCloseTo(1)
    expect(layout.yOffset).toBeCloseTo(0)
    expect(layout.forwardOffset).toBeCloseTo(0)
  })

  it('keeps the real cabin plane near its authored distance on compact portrait viewports', () => {
    const layout = windowFrameViewportLayout(393 / 852)

    expect(layout.frameDistance).toBeLessThan(3.1)
    expect(layout.scale).toBeCloseTo(1)
    expect(layout.yOffset).toBeLessThan(0)
    expect(layout.forwardOffset).toBeGreaterThan(0)
  })
})

describe('modern coach bay layout', () => {
  it('keeps the shared table below the physical journey rail', () => {
    const bay = windowBayLayout()
    const hud = windowHudSurfaceLayout().rail

    expect(bay.tableY + bay.tableHeight / 2).toBeLessThan(hud.y - hud.height / 2 - 0.1)
  })

  it('lets the lounge seating frame the aperture without crossing the HUD', () => {
    const bay = windowBayLayout()
    const hud = windowHudSurfaceLayout().rail
    const seatInnerEdge = bay.seatCenterX - bay.seatWidth / 2

    expect(seatInnerEdge).toBeGreaterThan(Math.abs(hud.x) + hud.width / 2 + 0.1)
  })

  it('uses real opposing couch and shared-table proportions', () => {
    const bay = windowBayLayout()

    expect(bay.seatLength).toBeGreaterThan(2)
    expect(bay.tableWidth).toBeGreaterThan(1.4)
    expect(bay.tableDepth).toBeGreaterThan(0.8)
  })

  it('extends the passenger bay into a finished multi-window coach section', () => {
    const cabin = coachCabinLayout()

    expect(cabin.windowCenters).toEqual([-5.3, 0, 5.3])
    expect(cabin.windowCenters[1] - cabin.windowCenters[0]).toBeGreaterThan(4.45)
    expect(cabin.ceilingY).toBeLessThan(2.2)
    expect(cabin.windowBottomY - cabin.floorY).toBeGreaterThan(0.9)
    expect(cabin.seatBackrestTop).toBeGreaterThan(0)
  })
})
