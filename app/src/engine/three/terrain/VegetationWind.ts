/** A quadratic profile keeps the bottom of each sprite planted while the tips
 * receive the full world-space gust. This pure module remains testable without
 * loading terrain textures or allocating a WebGL context. */
export function grassWindProfile(localHeight: number): number {
  const height = Math.min(1, Math.max(0, localHeight))
  return height * height
}
