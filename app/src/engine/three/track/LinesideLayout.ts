import { trackElevationAt, trackGradeAt } from '../terrain/RouteProfile'

export const CATENARY_POLE_X = 8
const CONTACT_WIRE_HEIGHT = 5.9

export type HeightSampler = (x: number, z: number) => number

/** Catenary bases use the rendered terrain sample, never the world origin. */
export function catenaryPoleBaseHeight(sampleHeight: HeightSampler, z: number): number {
  return sampleHeight(CATENARY_POLE_X, z)
}

/** Keep the long contact wire tangent to the engineered rail profile. */
export function contactWirePose(z: number) {
  return {
    y: trackElevationAt(z) + CONTACT_WIRE_HEIGHT,
    pitch: -Math.atan(trackGradeAt(z)),
  }
}

export function contactWireHeight(): number {
  return CONTACT_WIRE_HEIGHT
}
