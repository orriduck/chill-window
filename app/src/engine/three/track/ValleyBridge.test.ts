import { describe, expect, it } from 'vitest'
import { ROADBED_OFFSET } from '../terrain/TerrainGen'
import { trackElevationAt } from '../terrain/RouteProfile'
import { valleyRoadBridgeDeckElevationAt } from './ValleyBridge'

describe('valley road bridge elevation', () => {
  it('keeps the finished bridge deck level with the engineered country road', () => {
    const z = 3_360
    const deckThickness = 0.24

    expect(valleyRoadBridgeDeckElevationAt(z) + deckThickness / 2)
      .toBeCloseTo(trackElevationAt(z) + ROADBED_OFFSET, 6)
  })
})
