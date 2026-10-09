import { CHUNK_SIZE } from './DecorationPlacement'

export const VISIBLE_CHUNK_COUNT = 6
/** The passenger only sees +X: two depth bands, three rows along the rail.
 * The editor can inspect farther into that side without loading the back side. */
export function terrainFootprint(focusX: number, focusZ: number, editing = false) {
  const x = editing ? Math.max(0, Math.floor(focusX / CHUNK_SIZE) - 1) : 0
  const z = Math.floor(focusZ / CHUNK_SIZE)
  return { x, z, minX: x * CHUNK_SIZE, maxX: (x + 2) * CHUNK_SIZE, minZ: (z - 1) * CHUNK_SIZE, maxZ: (z + 2) * CHUNK_SIZE }
}
export function terrainTiles(focusX: number, focusZ: number, editing = false) {
  const { x, z } = terrainFootprint(focusX, focusZ, editing)
  const tiles: { x: number; z: number }[] = []
  for (let dz = -1; dz <= 1; dz++) for (let dx = 0; dx < 2; dx++) tiles.push({ x: x + dx, z: z + dz })
  return tiles
}
