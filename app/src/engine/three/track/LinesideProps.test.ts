import { describe, expect, it } from 'vitest'
import { trackElevationAt, trackGradeAt } from '../terrain/RouteProfile'
import { catenaryPoleBaseHeight, contactWirePose } from './LinesideLayout'

describe('lineside catenary placement', () => {
  it('anchors every mast base to the same rendered ground sampler as nearby props', () => {
    const sampleHeight = (x: number, z: number) => 1.8 + x * 0.04 - z * 0.002

    expect(catenaryPoleBaseHeight(sampleHeight, 640)).toBeCloseTo(sampleHeight(8, 640))
    expect(catenaryPoleBaseHeight(sampleHeight, 640)).not.toBeCloseTo(0)
  })

  it('keeps the contact wire tangent to the rail corridor instead of world-flat', () => {
    const z = 1_760
    const pose = contactWirePose(z)

    expect(pose.y).toBeCloseTo(trackElevationAt(z) + 5.9)
    expect(pose.pitch).toBeCloseTo(-Math.atan(trackGradeAt(z)))
  })
})
