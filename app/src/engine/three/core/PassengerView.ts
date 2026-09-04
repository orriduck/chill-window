/** One authored eye position shared by the exterior camera and cabin pass.
 * Cabin X runs along the train; cabin Z runs from the glazing into the aisle.
 * The window seat eye is at local (-1.45, -0.12, 1.0), over the near cushion. */
export type PassengerView = 'window' | 'aisle'
export const PASSENGER_VIEWS = {
  window: { wallDistance: 1.0, windowOffset: 1.45, wallYOffset: 0.12, yaw: Math.PI / 3, pitch: -0.07 },
  aisle: { wallDistance: 2.85, windowOffset: 0.5, wallYOffset: 0, yaw: Math.atan2(50, 12), pitch: Math.atan2(-0.5, Math.hypot(50, 12)) },
} as const
