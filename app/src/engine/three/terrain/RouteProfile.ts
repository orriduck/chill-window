/**
 * Continuous vertical alignment for the rail route. The long wavelengths
 * keep mainline grades gentle while still making a climb readable over a
 * focus journey. Values are world-space units per world-space unit.
 */
const LONG_AMPLITUDE = 3.1
const LONG_FREQUENCY = 0.0011
const SHORT_AMPLITUDE = 1.1
const SHORT_FREQUENCY = 0.0037
const SHORT_PHASE = 1.2

export function trackElevationAt(z: number): number {
  return (
    Math.sin(z * LONG_FREQUENCY) * LONG_AMPLITUDE +
    Math.sin(z * SHORT_FREQUENCY + SHORT_PHASE) * SHORT_AMPLITUDE
  )
}

export function trackGradeAt(z: number): number {
  return (
    Math.cos(z * LONG_FREQUENCY) * LONG_AMPLITUDE * LONG_FREQUENCY +
    Math.cos(z * SHORT_FREQUENCY + SHORT_PHASE) * SHORT_AMPLITUDE * SHORT_FREQUENCY
  )
}
