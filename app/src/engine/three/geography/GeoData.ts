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
export interface HudsonStationSnapshot {
  routeWorldSha256: string
  stations: Array<{ id: string; name: string; location: LonLat; sMetres: number; distanceToRouteMetres: number; inCurrentRoute: boolean; empireServiceStopsHere: boolean; platformIds: string[]; platformAssociations: Array<{ id: string; method: string; relationId?: string; distanceMetres?: number }> }>
  features: Array<{ id: string; coordinates: LonLat[]; tags: Record<string, string> }>
}
export interface BuildingOverlaySnapshot {
  baseWorldSha256: string
  release: string
  sources: Array<{ release: string; bbox: [number, number, number, number]; type: string; license: string; fetchedAt: string; client: string; clientVersion: string; responseSha256: string; features: number; documentation: string }>
  stats: { originalOSM: number; upstream: number; addedBuildings: number; matched: number; heightEnriched: number; outputComponents: number; buildingParts: number; heightStatus: Record<string, number> }
  features: Array<{
    id: string | number; kind: 'building'; coordinates: LonLat[]; holes?: LonLat[][]; tags: Record<string, string>
    buildingHeight: { metres: number | null; status: 'source_tag' | 'source_estimate' | 'missing' | 'floors_only'; method: string | null; sources?: Array<{ dataset: string; property?: string }>; sourceDatasets?: string[] }
    provenance: { geometry: { dataset: string; recordId?: string; gersId?: string; release?: string }; overtureMatches: Array<{ gersId: string; iou: number; release: string }> }
    overtureProperties: Record<string, unknown>
  }>
  buildingParts: Array<{ id: string; geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] }; parentFeatureId: string; buildingHeight: { metres: number | null; status: string; method: string | null; sourceDatasets?: string[] }; properties: Record<string, unknown> }>
}
export type MappedHudsonStation = HudsonStationSnapshot['stations'][number] & {
  point: GeoPoint
  platforms: Array<MappedFeature & { closed: boolean; association: HudsonStationSnapshot['stations'][number]['platformAssociations'][number] }>
}
export interface GeoPoint { x: number; z: number }
export interface MappedFeature extends Omit<GeographicFeature, 'coordinates' | 'holes'> {
  coordinates: GeoPoint[]; holes: GeoPoint[][]; bounds: [number, number, number, number]
  buildingHeight?: BuildingOverlaySnapshot['features'][number]['buildingHeight']
  provenance?: BuildingOverlaySnapshot['features'][number]['provenance']
  overtureProperties?: Record<string, unknown>
}
export interface MappedBuildingPart {
  id: string; parentFeatureId: string; coordinates: GeoPoint[]; holes: GeoPoint[][]; bounds: [number, number, number, number]
  height: number | null; minHeight: number; roofShape: string | null; facadeMaterial: string | null; roofMaterial: string | null; sourceDatasets: string[]
  roofColor: string | null
}
export interface RoutePose extends GeoPoint { s: number; dx: number; dz: number; heading: number; longitude: number; latitude: number }
export type BuildingHeightStatus = 'tagged' | 'estimated-from-levels' | 'source-tag' | 'source-estimate' | 'floors-only' | 'missing'
export interface BuildingHeightInfo { status: BuildingHeightStatus; metres: number | null; raw: string | null; sources?: string[]; method?: string | null }
export type BuildingStructureKind = 'open-shelter' | 'building'
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
  readonly stations: MappedHudsonStation[]
  readonly buildingParts: MappedBuildingPart[]
  readonly buildingOverlay: BuildingOverlaySnapshot | null
  readonly elevations: Float32Array
  constructor(bundle: GeoBundle, elevations: Float32Array, stationSnapshot?: HudsonStationSnapshot, buildingOverlay?: BuildingOverlaySnapshot) {
    this.bundle = bundle; this.elevations = elevations
    this.buildingOverlay = buildingOverlay ?? null
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
    const overlayById = new Map((buildingOverlay?.features ?? []).filter(f => String(f.id).startsWith('osm/')).map(f => [String(f.id), f]))
    const overlayIds = new Set((buildingOverlay?.features ?? []).filter(f => String(f.id).startsWith('overture/')).map(f => String(f.id)))
    const baseFeatures = bundle.features.map(feature => {
      const metadata = feature.kind === 'building' ? overlayById.get(String(feature.id)) : undefined
      return metadata ? { ...feature, buildingHeight: metadata.buildingHeight, provenance: metadata.provenance, overtureProperties: metadata.overtureProperties } : feature
    })
    for (const feature of buildingOverlay?.features ?? []) if (overlayIds.has(String(feature.id))) baseFeatures.push(feature as GeographicFeature & Pick<MappedFeature, 'buildingHeight' | 'provenance' | 'overtureProperties'>)
    this.features = baseFeatures.filter(f => f.coordinates.length >= 2).map(f => {
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
    const rawParts = (buildingOverlay?.buildingParts ?? []).flatMap(part => {
      const polygons = part.geometry.type === 'Polygon' ? [part.geometry.coordinates as number[][][]] : part.geometry.coordinates as number[][][][]
      return polygons.map((rings, index) => {
        const coordinates = rings[0].map(([lon, lat]) => this.project([lon, lat] as LonLat)), holes = rings.slice(1).map(ring => ring.map(([lon, lat]) => this.project([lon, lat] as LonLat)))
        const xs = coordinates.map(point => point.x), zs = coordinates.map(point => point.z), properties = part.properties
        return { id: `${part.id}${polygons.length > 1 ? `/${index}` : ''}`, parentFeatureId: part.parentFeatureId, coordinates, holes,
          bounds: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] as [number, number, number, number],
          height: part.buildingHeight.metres, minHeight: Number(properties.min_height) || 0,
          roofShape: typeof properties.roof_shape === 'string' ? properties.roof_shape : null,
          facadeMaterial: typeof properties.facade_material === 'string' ? properties.facade_material : null,
          roofMaterial: typeof properties.roof_material === 'string' ? properties.roof_material : null,
          roofColor: typeof properties.roof_color === 'string' ? properties.roof_color : null,
          sourceDatasets: part.buildingHeight.sourceDatasets ?? [] }
      })
    })
    this.buildingParts = rawParts
    const stationFeatures = new Map((stationSnapshot?.features ?? []).map(feature => [feature.id, feature]))
    this.stations = (stationSnapshot?.stations ?? []).map(station => ({
      ...station,
      point: this.project(station.location),
      platforms: station.platformIds.flatMap(id => {
        const raw = stationFeatures.get(id), association = station.platformAssociations.find(item => item.id === id)
        if (!raw || !association || Object.keys(raw.tags).some(key => key.startsWith('disused:') || key.startsWith('abandoned:'))) return []
        const coordinates = raw.coordinates.map(point => this.project(point))
        const first = coordinates[0], last = coordinates.at(-1)!
        const closed = coordinates.length >= 4 && Math.hypot(first.x - last.x, first.z - last.z) < 0.25
        const xs = coordinates.map(point => point.x), zs = coordinates.map(point => point.z)
        const feature: MappedFeature = { id: raw.id, kind: 'rail', tags: raw.tags, coordinates, holes: [], bounds: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] }
        return [{ ...feature, closed, association }]
      }),
    }))
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
  get buildingStats() {
    const buildings = this.features.filter(feature => feature.kind === 'building')
    const status = (key: BuildingHeightStatus) => buildings.filter(feature => buildingHeight(feature).status === key).length
    const roof = buildings.filter(feature => feature.overtureProperties?.roof_shape || feature.tags['roof:shape'] || feature.tags['building:roof:shape']).length
    const floors = buildings.filter(feature => feature.overtureProperties?.num_floors || feature.tags['building:levels']).length
    return { total: buildings.length, tagged: status('tagged'), estimated: status('estimated-from-levels'), sourceTag: status('source-tag'), sourceEstimate: status('source-estimate'), floorsOnly: status('floors-only'), missing: status('missing'), shelters: buildings.filter(feature => buildingStructureKind(feature) === 'open-shelter').length, floorTags: floors, roof, parts: this.buildingParts.length, added: buildings.filter(feature => String(feature.id).startsWith('overture/')).length }
  }
  buildingAt(x: number, z: number) {
    return this.nearbyFeatures(x, z).find(feature => feature.kind === 'building' && contains(feature, x, z)) ?? null
  }
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

/** Use explicit source height tags as given. Floor counts yield a labeled
 * visualization estimate; buildings without either stay as footprints. */
export function buildingHeight(feature: Pick<MappedFeature, 'tags'> & Partial<Pick<MappedFeature, 'buildingHeight'>>): BuildingHeightInfo {
  if (feature.buildingHeight) return { status: feature.buildingHeight.status.replaceAll('_', '-') as BuildingHeightStatus, metres: feature.buildingHeight.metres, raw: feature.buildingHeight.metres === null ? null : `${feature.buildingHeight.metres}m source value`, sources: feature.buildingHeight.sources?.map(source => source.dataset) ?? feature.buildingHeight.sourceDatasets, method: feature.buildingHeight.method }
  const raw = feature.tags.height?.trim() || null
  if (raw) {
    const match = raw.match(/^\s*(\d+(?:\.\d+)?)\s*(m|meter|meters|metre|metres|ft|feet|')?\s*$/i)
    if (match) {
      const value = Number(match[1])
      const metres = /^(ft|feet|')$/i.test(match[2] ?? '') ? value * 0.3048 : value
      if (Number.isFinite(metres) && metres > 0 && metres <= 500) return { status: 'tagged', metres, raw }
    }
  }
  const levels = Number.parseFloat(feature.tags['building:levels'] ?? '')
  if (Number.isFinite(levels) && levels > 0 && levels <= 120) return { status: 'estimated-from-levels', metres: levels * 3.1, raw: `${levels} levels × 3.1 m visualization assumption` }
  return { status: 'missing', metres: null, raw }
}

/** Structural tags and source classes take precedence over the broad
 * `building=*` umbrella: public-transport shelters are open structures. */
export function buildingStructureKind(feature: Pick<MappedFeature, 'tags'> & Partial<Pick<MappedFeature, 'overtureProperties'>>): BuildingStructureKind {
  const properties = feature.overtureProperties ?? {}
  const classes = [properties.class, properties.subtype].filter((value): value is string => typeof value === 'string').map(value => value.toLowerCase())
  if (feature.tags.amenity === 'shelter' || feature.tags.shelter_type || classes.includes('shelter')) return 'open-shelter'
  return 'building'
}

export async function loadHudsonData(signal?: AbortSignal) {
  const base = `${import.meta.env.BASE_URL}geodata/hudson/`
  const response = await fetch(`${base}world.json`, { signal })
  if (!response.ok) throw new Error(`路线数据 HTTP ${response.status}`)
  const [worldBuffer, stationsResponse, buildingsResponse] = await Promise.all([
    response.arrayBuffer(), fetch(`${base}stations.json`, { signal }), fetch(`${base}buildings.json`, { signal }),
  ])
  if (!stationsResponse.ok) throw new Error(`车站数据 HTTP ${stationsResponse.status}`)
  if (!buildingsResponse.ok) throw new Error(`建筑覆盖数据 HTTP ${buildingsResponse.status}`)
  const bundle = JSON.parse(new TextDecoder().decode(worldBuffer)) as GeoBundle
  const stationSnapshot = await stationsResponse.json() as HudsonStationSnapshot
  const digest = await crypto.subtle.digest('SHA-256', worldBuffer)
  const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
  if (hash !== stationSnapshot.routeWorldSha256) throw new Error('车站数据绑定的路线快照校验失败')
  const buildingOverlay = await buildingsResponse.json() as BuildingOverlaySnapshot
  const buildingBaseHash = await crypto.subtle.digest('SHA-256', worldBuffer)
  const buildingHash = [...new Uint8Array(buildingBaseHash)].map(value => value.toString(16).padStart(2, '0')).join('')
  if (buildingHash !== buildingOverlay.baseWorldSha256) throw new Error('建筑数据绑定的路线快照校验失败')
  const demResponse = await fetch(`${base}${bundle.dem.file}`, { signal })
  if (!demResponse.ok) throw new Error(`高程数据 HTTP ${demResponse.status}`)
  const buffer = await demResponse.arrayBuffer()
  if (buffer.byteLength % 4) throw new Error('高程文件长度错误')
  return new GeoData(bundle, new Float32Array(buffer), stationSnapshot, buildingOverlay)
}
