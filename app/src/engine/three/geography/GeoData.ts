import { MathUtils } from 'three'

export type LonLat = [number, number]
export interface GeographicFeature {
  id: string | number
  kind: 'water' | 'forest' | 'building' | 'road' | 'rail' | 'farmland'
  coordinates: LonLat[]
  holes?: LonLat[][]
  tags: Record<string, string>
}
export interface GeoSource { name: string; url: string; date: string; description?: string }
export interface GeoBundle {
  origin: LonLat
  route: { name: string; points: LonLat[]; source: unknown }
  dem: { width: number; height: number; bounds: [number, number, number, number]; resolution: [number, number]; file: string; rowOrder: string; source: unknown }
  features: GeographicFeature[]
  sources: GeoSource[]
  bounds: [number, number, number, number]
}
export interface GeoPoint { x: number; z: number }
export interface MappedFeature extends Omit<GeographicFeature, 'coordinates' | 'holes'> {
  coordinates: GeoPoint[]; holes: GeoPoint[][]; bounds: [number, number, number, number]
}
export interface RoutePose extends GeoPoint { s: number; dx: number; dz: number; heading: number; longitude: number; latitude: number }
const R = 6378137
const RAD = Math.PI / 180
const mercatorNorth = (lat: number) => R * Math.log(Math.tan(Math.PI / 4 + lat * RAD / 2))

export function insideRing(x: number, z: number, points: GeoPoint[]) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j]
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside
  }
  return inside
}
export function contains(feature: MappedFeature, x: number, z: number) {
  const [minX, minZ, maxX, maxZ] = feature.bounds
  return x >= minX && x <= maxX && z >= minZ && z <= maxZ && insideRing(x, z, feature.coordinates) && !feature.holes.some(hole => insideRing(x, z, hole))
}
export function segmentDistance(x: number, z: number, a: GeoPoint, b: GeoPoint) {
  const dx = b.x - a.x, dz = b.z - a.z
  const t = MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / Math.max(dx * dx + dz * dz, 1e-8), 0, 1)
  return { distance: Math.hypot(x - a.x - dx * t, z - a.z - dz * t), t }
}

/** Pure source-data access: missing coverage returns null, never synthetic noise. */
export class GeoData {
  readonly points: GeoPoint[]
  readonly distances: number[] = [0]
  readonly features: MappedFeature[]
  readonly length: number
  readonly checkpoints: { label: string; s: number }[]
  private featureBins = new Map<string, MappedFeature[]>()
  private railHeights: number[] = []
  private routeBins = new Map<string, number[]>()
  private railStep = 20
  private k: number
  readonly engineeringNotice = '轨面为 DEM 平滑估计；桥隧高度为可视化近似'
  readonly bundle: GeoBundle
  readonly elevations: Float32Array
  constructor(bundle: GeoBundle, elevations: Float32Array) {
    this.bundle = bundle; this.elevations = elevations
    const d = bundle.dem
    if (!Number.isInteger(d.width) || !Number.isInteger(d.height) || d.width < 2 || d.height < 2 || elevations.length !== d.width * d.height || d.rowOrder !== 'south-to-north') throw new Error('DEM 网格或行序无效')
    for (const height of elevations) if (!Number.isFinite(height) || height < -500 || height > 9000) throw new Error('DEM 包含无效高程')
    this.k = Math.cos(bundle.origin[1] * RAD)
    this.points = bundle.route.points.map(point => this.project(point))
    if (this.points.length < 2) throw new Error('真实路线没有有效折线')
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1], b = this.points[i]
      this.distances.push(this.distances[i - 1] + Math.hypot(b.x - a.x, b.z - a.z))
      for (let cx = Math.floor((Math.min(a.x, b.x) - 32) / 256); cx <= Math.floor((Math.max(a.x, b.x) + 32) / 256); cx++) for (let cz = Math.floor((Math.min(a.z, b.z) - 32) / 256); cz <= Math.floor((Math.max(a.z, b.z) + 32) / 256); cz++) {
        const key = `${cx},${cz}`, values = this.routeBins.get(key) ?? []
        values.push(i - 1); this.routeBins.set(key, values)
      }
    }
    this.length = this.distances.at(-1)!
    if (this.length < 100 || this.points.some(p => this.heightAt(p.x, p.z) === null)) throw new Error('路线超出真实高程覆盖')
    this.features = bundle.features.filter(f => f.coordinates.length >= 2).map(f => {
      const coordinates = f.coordinates.map(p => this.project(p)), holes = (f.holes ?? []).map(ring => ring.map(p => this.project(p)))
      const xs = coordinates.map(p => p.x), zs = coordinates.map(p => p.z)
      const feature: MappedFeature = { ...f, coordinates, holes, bounds: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] }
      const [minX, minZ, maxX, maxZ] = feature.bounds
      for (let cx = Math.floor(minX / 256); cx <= Math.floor(maxX / 256); cx++) for (let cz = Math.floor(minZ / 256); cz <= Math.floor(maxZ / 256); cz++) {
        const key = `${cx},${cz}`, bin = this.featureBins.get(key) ?? []
        bin.push(feature); this.featureBins.set(key, bin)
      }
      return feature
    })
    this.buildRailProfile()
    this.checkpoints = [
      { label: '北段 · 河岸', s: this.length * 0.08 },
      { label: '中段 · 哈德逊高地', s: this.length * 0.46 },
      { label: '南段 · 城镇', s: this.length * 0.94 },
    ]
  }
  project([lon, lat]: LonLat): GeoPoint {
    return { x: (lon - this.bundle.origin[0]) * RAD * R * this.k, z: (mercatorNorth(lat) - mercatorNorth(this.bundle.origin[1])) * this.k }
  }
  unproject(x: number, z: number): LonLat {
    return [this.bundle.origin[0] + x / (RAD * R * this.k), (2 * Math.atan(Math.exp((z / this.k + mercatorNorth(this.bundle.origin[1])) / R)) - Math.PI / 2) / RAD]
  }
  pose(s: number): RoutePose {
    s = MathUtils.clamp(s, 0, this.length)
    let lo = 0, hi = this.points.length - 2
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (this.distances[mid] <= s) lo = mid; else hi = mid - 1 }
    const a = this.points[lo], b = this.points[lo + 1], length = this.distances[lo + 1] - this.distances[lo]
    const t = length > 0 ? (s - this.distances[lo]) / length : 0
    const x = MathUtils.lerp(a.x, b.x, t), z = MathUtils.lerp(a.z, b.z, t)
    // Average the direction over 24m, avoiding visible rotation steps at vertices.
    const before = this.pointAtDistance(Math.max(0, s - 12)), after = this.pointAtDistance(Math.min(this.length, s + 12))
    const norm = Math.max(Math.hypot(after.x - before.x, after.z - before.z), 1e-8)
    const dx = (after.x - before.x) / norm, dz = (after.z - before.z) / norm
    const [longitude, latitude] = this.unproject(x, z)
    return { x, z, s, dx, dz, heading: Math.atan2(dx, dz), longitude, latitude }
  }
  private pointAtDistance(s: number): GeoPoint {
    let lo = 0, hi = this.points.length - 2
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (this.distances[mid] <= s) lo = mid; else hi = mid - 1 }
    const a = this.points[lo], b = this.points[lo + 1], delta = this.distances[lo + 1] - this.distances[lo]
    const t = delta ? (s - this.distances[lo]) / delta : 0
    return { x: MathUtils.lerp(a.x, b.x, t), z: MathUtils.lerp(a.z, b.z, t) }
  }
  heightAt(x: number, z: number): number | null {
    const { width, height, bounds } = this.bundle.dem
    const [minX, minZ, maxX, maxZ] = bounds
    if (!Number.isFinite(x) || !Number.isFinite(z) || x < minX - 1e-6 || x > maxX + 1e-6 || z < minZ - 1e-6 || z > maxZ + 1e-6) return null
    const fx = MathUtils.clamp((x - minX) / (maxX - minX) * (width - 1), 0, width - 1), fz = MathUtils.clamp((z - minZ) / (maxZ - minZ) * (height - 1), 0, height - 1)
    const col = Math.min(width - 2, Math.floor(fx)), row = Math.min(height - 2, Math.floor(fz)), tx = fx - col, tz = fz - row
    const i = row * width + col, data = this.elevations
    return MathUtils.lerp(MathUtils.lerp(data[i], data[i + 1], tx), MathUtils.lerp(data[i + width], data[i + width + 1], tx), tz)
  }
  nearbyFeatures(x: number, z: number) { return this.featureBins.get(`${Math.floor(x / 256)},${Math.floor(z / 256)}`) ?? [] }
  landAt(x: number, z: number, kind: GeographicFeature['kind']) { return this.nearbyFeatures(x, z).some(f => f.kind === kind && contains(f, x, z)) }
  railProximity(x: number, z: number) {
    let best = { distance: Infinity, s: 0 }
    for (const i of this.routeBins.get(`${Math.floor(x / 256)},${Math.floor(z / 256)}`) ?? []) {
      const match = segmentDistance(x, z, this.points[i], this.points[i + 1])
      if (match.distance < best.distance) best = { distance: match.distance, s: this.distances[i] + (this.distances[i + 1] - this.distances[i]) * match.t }
    }
    return best
  }
  engineeringKindAt(x: number, z: number): 'tunnel' | 'bridge' | null {
    const rails = this.nearbyFeatures(x, z).filter(f => f.kind === 'rail' && (f.tags.bridge === 'yes' || f.tags.tunnel === 'yes') && f.coordinates.some((a, i) => i > 0 && segmentDistance(x, z, f.coordinates[i - 1], a).distance < 20))
    return rails.some(f => f.tags.tunnel === 'yes') ? 'tunnel' : rails.length ? 'bridge' : null
  }
  engineeringAt(x: number, z: number) { return this.engineeringKindAt(x, z) !== null }
  nearestRoute(x: number, z: number) {
    let best = { distance: Infinity, s: 0 }
    for (let i = 0; i < this.points.length - 1; i++) {
      const match = segmentDistance(x, z, this.points[i], this.points[i + 1])
      if (match.distance < best.distance) best = { distance: match.distance, s: this.distances[i] + (this.distances[i + 1] - this.distances[i]) * match.t }
    }
    return best
  }
  railHeight(s: number) {
    const index = MathUtils.clamp(s / this.railStep, 0, this.railHeights.length - 1)
    const i = Math.min(this.railHeights.length - 2, Math.floor(index))
    return MathUtils.lerp(this.railHeights[i], this.railHeights[i + 1], index - i)
  }
  railGrade(s: number) { return (this.railHeight(s + 10) - this.railHeight(s - 10)) / 20 }
  private buildRailProfile() {
    const count = Math.ceil(this.length / this.railStep) + 1
    const raw = Array.from({ length: count }, (_, i) => { const p = this.pose(Math.min(this.length, i * this.railStep)); return Math.max(1.2, this.heightAt(p.x, p.z)! + 0.3) })
    // Engineering labels are horizontal OSM alignments. Estimate deck/tunnel
    // height between the neighbouring non-engineering ground anchors rather
    // than sampling a riverbed or climbing the ground above a tunnel.
    const engineered = Array.from({ length: count }, (_, i) => { const p = this.pose(Math.min(this.length, i * this.railStep)); return this.engineeringAt(p.x, p.z) })
    for (let start = 0; start < count; start++) if (engineered[start]) {
      let end = start
      while (end + 1 < count && engineered[end + 1]) end++
      const before = Math.max(0, start - 1), after = Math.min(count - 1, end + 1)
      for (let i = start; i <= end; i++) raw[i] = MathUtils.lerp(raw[before], raw[after], (i - before) / Math.max(1, after - before))
      start = end
    }
    this.railHeights = raw.map((_, i) => {
      const window = raw.slice(Math.max(0, i - 3), Math.min(raw.length, i + 4)).sort((a, b) => a - b)
      return window[Math.floor(window.length / 2)]
    })
    // Ground DEM is not a railway survey: keep the approximate alignment
    // within a mainline-like 2% grade instead of riding every raster bump.
    for (let i = 1; i < count; i++) this.railHeights[i] = MathUtils.clamp(this.railHeights[i], this.railHeights[i - 1] - 0.4, this.railHeights[i - 1] + 0.4)
    for (let i = count - 2; i >= 0; i--) this.railHeights[i] = MathUtils.clamp(this.railHeights[i], this.railHeights[i + 1] - 0.4, this.railHeights[i + 1] + 0.4)
  }
}

export async function loadHudsonData(signal?: AbortSignal) {
  const base = `${import.meta.env.BASE_URL}geodata/hudson/`
  const response = await fetch(`${base}world.json`, { signal })
  if (!response.ok) throw new Error(`路线数据 HTTP ${response.status}`)
  const bundle = await response.json() as GeoBundle
  const demResponse = await fetch(`${base}${bundle.dem.file}`, { signal })
  if (!demResponse.ok) throw new Error(`高程数据 HTTP ${demResponse.status}`)
  const buffer = await demResponse.arrayBuffer()
  if (buffer.byteLength % 4) throw new Error('高程文件长度错误')
  return new GeoData(bundle, new Float32Array(buffer))
}
