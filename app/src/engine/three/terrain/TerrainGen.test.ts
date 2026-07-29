import { describe, expect, it } from 'vitest'
import { getBiomeConfig } from './Biome'
import { roadCenterX, ROADBED_OFFSET, ROAD_VERGE, TerrainGen } from './TerrainGen'
import { trackElevationAt } from './RouteProfile'

describe('engineered roadbeds', () => {
  it('holds a fully surfaced road at its shared railway engineering elevation', () => {
    const z = 2_240
    const params = { ...getBiomeConfig('town').heightParams, road: 1 }
    const terrain = new TerrainGen()

    expect(terrain.getHeight(roadCenterX(z), z, params)).toBeCloseTo(trackElevationAt(z) + ROADBED_OFFSET, 6)
  })

  it('eases back to natural terrain outside the road verge', () => {
    const z = 2_240
    const params = { ...getBiomeConfig('town').heightParams, road: 1 }
    const terrain = new TerrainGen()
    const roadbed = terrain.getHeight(roadCenterX(z), z, params)
    const meadow = terrain.getHeight(roadCenterX(z) + ROAD_VERGE + 2, z, params)

    expect(meadow).not.toBeCloseTo(roadbed, 4)
  })
})
