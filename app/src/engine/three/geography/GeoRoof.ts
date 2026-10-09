import * as THREE from 'three'
import type { GeoPoint } from './GeoData'

/** A source-tagged pyramidal roof needs an interior apex. Raising only the
 * triangulated footprint boundary produces a flat roof at the eave height.
 * The apex must see every outline edge from inside the footprint. Holed
 * outlines and those without this kernel stay unmodelled instead of
 * spilling a guessed roof outside the mapped building. */
export function pyramidalRoof(points: GeoPoint[], holes: GeoPoint[][], height: number) {
  if (holes.length || !Number.isFinite(height) || height <= 0) return null
  const ring = [...points]
  if (ring.length > 1 && Math.hypot(ring[0].x - ring.at(-1)!.x, ring[0].z - ring.at(-1)!.z) < 0.01) ring.pop()
  if (ring.length < 3) return null
  let area2 = 0, cx = 0, cz = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]
    const cross = a.x * b.z - b.x * a.z
    area2 += cross; cx += (a.x + b.x) * cross; cz += (a.z + b.z) * cross
  }
  if (Math.abs(area2) < 1e-4) return null
  cx /= 3 * area2; cz /= 3 * area2
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]
    if (Math.sign(area2) * ((b.x - a.x) * (cz - a.z) - (b.z - a.z) * (cx - a.x)) < -1e-6) return null
  }
  const vertices: number[] = []
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]
    const triangle = area2 > 0 ? [[a.x, 0, a.z], [cx, height, cz], [b.x, 0, b.z]] : [[a.x, 0, a.z], [b.x, 0, b.z], [cx, height, cz]]
    for (const point of triangle) vertices.push(...point)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.computeVertexNormals()
  return geometry
}
