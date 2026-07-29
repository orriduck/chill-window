export const CHUNK_SIZE = 256
// Trees, shrubs and rocks reserve 15m from other props inside one chunk. A
// narrow ownership band makes the same rule hold across independently streamed
// neighbours, preventing doubled silhouettes at a chunk seam.
export const DECORATION_EDGE_CLEARANCE = 8

/** Whether a large decoration belongs to this chunk rather than its seam.
 * Grass is deliberately excluded: its density should remain continuous. */
export function isDecorationInsideChunk(
  x: number,
  z: number,
  worldX: number,
  worldZ: number,
  clearance = DECORATION_EDGE_CLEARANCE,
): boolean {
  return (
    x >= worldX + clearance &&
    x <= worldX + CHUNK_SIZE - clearance &&
    z >= worldZ + clearance &&
    z <= worldZ + CHUNK_SIZE - clearance
  )
}
