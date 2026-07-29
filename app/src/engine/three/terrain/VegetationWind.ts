/** A quadratic profile keeps the bottom of each sprite planted while the tips
 * receive the full world-space gust. This pure module remains testable without
 * loading terrain textures or allocating a WebGL context. */
export function grassWindProfile(localHeight: number): number {
  const height = Math.min(1, Math.max(0, localHeight))
  return height * height
}

/** Keep the expensive density increase inside the nearest terrain band. */
export function grassSpacingForLod(densityScale: number): number {
  if (densityScale >= 1) return 1.55
  if (densityScale >= 0.5) return 3.6
  return 6
}
