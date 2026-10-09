/** Shared planted-field footprint; foliage and crop meshes must agree. */
export const FIELD_LANES = [{ x: 60, width: 48 }, { x: 120, width: 56 }, { x: 192, width: 72 }] as const
export const FIELD_LENGTH = 92
export const FIELD_PITCH = 100
/** Pond parcels and banks share this footprint with the carved ground. */
export function isPondParcel(lane: number, row: number): boolean {
  return ((row * 3 + lane * 2) % 7 + 7) % 7 < 3
}
export function fieldParcelAt(x: number, z: number) {
  const lane = FIELD_LANES.findIndex(l => Math.abs(x - l.x) <= l.width / 2 + 1e-6)
  if (lane < 0) return null
  const row = Math.floor((z + 1e-6) / FIELD_PITCH)
  return { lane, row, centerZ: row * FIELD_PITCH + 50, pond: isPondParcel(lane, row) }
}
export function isPlantedField(x: number, z: number): boolean {
  const localZ = ((z % FIELD_PITCH) + FIELD_PITCH) % FIELD_PITCH
  return localZ > 4 && localZ < 96 && FIELD_LANES.some(lane => Math.abs(x - lane.x) < lane.width / 2)
}
