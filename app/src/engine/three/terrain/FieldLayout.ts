/** Shared planted-field footprint; foliage and crop meshes must agree. */
export const FIELD_LANES = [{ x: 60, width: 48 }, { x: 120, width: 56 }, { x: 192, width: 72 }] as const
export const FIELD_LENGTH = 92
export const FIELD_PITCH = 100
export function isPlantedField(x: number, z: number): boolean {
  const localZ = ((z % FIELD_PITCH) + FIELD_PITCH) % FIELD_PITCH
  return localZ > 4 && localZ < 96 && FIELD_LANES.some(lane => Math.abs(x - lane.x) < lane.width / 2)
}
