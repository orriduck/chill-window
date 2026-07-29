const PROFILE_RUN_PX = 28
const MAX_PROFILE_RISE_PX = 7
const VISUAL_RISE_PER_GRADE = 600

/**
 * Converts a physical track grade into a small, bounded HUD profile angle.
 * The scale makes gentle railway grades perceptible without suggesting a
 * steeper route than the adjacent percentage reports.
 */
export function gradeProfileAngleDeg(grade: number): number {
  const rise = Math.min(
    MAX_PROFILE_RISE_PX,
    Math.max(-MAX_PROFILE_RISE_PX, grade * VISUAL_RISE_PER_GRADE),
  )
  if (rise === 0) return 0
  return (Math.atan2(-rise, PROFILE_RUN_PX) * 180) / Math.PI
}
