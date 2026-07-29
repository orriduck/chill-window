import { describe, expect, it } from 'vitest'
import {
  isTownRoadBridgeFootprint,
  TOWN_ROAD_BRIDGE_CLEARANCE,
  TOWN_ROAD_BRIDGE_DECK_THICKNESS,
  TOWN_ROAD_BRIDGE_PIER_XS,
  TOWN_ROAD_BRIDGE_TARGET_GRADE,
  townRoadBridgeLayout,
} from './TownRoadBridge'

describe('town road bridge layout', () => {
  const townX = 20
  const townZ = 3900
  const layout = townRoadBridgeLayout(townX, townZ)

  it('keeps a road bridge above the rail with a credible ramp grade', () => {
    expect(layout.deckStartX).toBeLessThan(-10)
    expect(layout.deckEndX).toBeGreaterThan(10)
    expect(TOWN_ROAD_BRIDGE_TARGET_GRADE).toBeGreaterThan(0.05)
    expect(TOWN_ROAD_BRIDGE_TARGET_GRADE).toBeLessThan(0.07)
    expect(TOWN_ROAD_BRIDGE_CLEARANCE - TOWN_ROAD_BRIDGE_DECK_THICKNESS).toBeGreaterThan(4.8)
    expect(TOWN_ROAD_BRIDGE_PIER_XS.every((x) => Math.abs(x) > 2)).toBe(true)
  })

  it('covers the deck, both approaches, and the rural continuation for foliage clearing', () => {
    expect(isTownRoadBridgeFootprint(0, layout.bridgeZ, townX, townZ)).toBe(true)
    expect(isTownRoadBridgeFootprint(layout.townRampX, layout.townRampEndZ, townX, townZ)).toBe(true)
    expect(isTownRoadBridgeFootprint(layout.ruralRampX, layout.ruralRoadEndZ, townX, townZ)).toBe(true)
    expect(isTownRoadBridgeFootprint(townX + 25, townZ + 20, townX, townZ)).toBe(false)
  })
})
