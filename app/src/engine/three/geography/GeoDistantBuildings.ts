import * as THREE from 'three'
import { buildingAppearance } from './GeoBuilding'
import { pyramidalRoof } from './GeoRoof'
import { detailCoverageDeclarations, detailCoverageLookup, type GeoDetailCoverage } from './GeoDetailCoverage'
import { buildingHeight, buildingStructureKind, type BuildingHeightStatus, type GeoData, type GeoPoint, type MappedBuildingPart, type MappedFeature } from './GeoData'

export const DISTANT_BUILDING_REGION_METRES = 1024
export const BUILDING_DETAIL_FADE_START_METRES = 650
export const BUILDING_DETAIL_FADE_END_METRES = 740

export type BuildingFadeRole = 'near' | 'far'
export interface BuildingFadeController {
  readonly role: BuildingFadeRole
  readonly focus: THREE.Vector2
  readonly coverage?: GeoDetailCoverage
  updateFocus(x: number, z: number): void
}

/** Shared by near and distant batches. Every vertex of a source building or
 * part must carry the same geographic centre so the two LODs cross-fade as a
 * pair, including large footprints that span chunk/region boundaries. */
export function createBuildingFadeController(role: BuildingFadeRole, coverage?: GeoDetailCoverage): BuildingFadeController {
  const focus = new THREE.Vector2()
  return { role, focus, coverage, updateFocus: (x, z) => focus.set(x, z) }
}

export function setBuildingCenterAttribute(geometry: THREE.BufferGeometry, x: number, z: number) {
  const count = geometry.getAttribute('position')?.count ?? 0
  const centers = new Float32Array(count * 2)
  for (let i = 0; i < count; i++) { centers[i * 2] = x; centers[i * 2 + 1] = z }
  geometry.setAttribute('geoBuildingCenter', new THREE.BufferAttribute(centers, 2))
}

/** Add a source-centre cross-fade to a vertex-colour building material. It
 * chains the material's existing hook and gives Three distinct program keys
 * for the near and distant roles. */
export function installBuildingDistanceFade(material: THREE.MeshStandardMaterial | THREE.LineBasicMaterial, controller: BuildingFadeController) {
  const previousCompile = material.onBeforeCompile
  const previousKey = material.customProgramCacheKey.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile(shader, renderer)
    shader.uniforms.geoBuildingFocus = { value: controller.focus }
    shader.uniforms.geoBuildingFadeStart = { value: BUILDING_DETAIL_FADE_START_METRES }
    shader.uniforms.geoBuildingFadeEnd = { value: BUILDING_DETAIL_FADE_END_METRES }
    if (controller.coverage) {
      shader.uniforms.geoDetailCoverage = { value: controller.coverage.texture }
      shader.uniforms.geoDetailMinTile = { value: controller.coverage.minTile }
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${detailCoverageDeclarations}`)
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 geoBuildingCenter;\nvarying vec2 vGeoBuildingCenter;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGeoBuildingCenter = geoBuildingCenter;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec2 geoBuildingFocus;\nuniform float geoBuildingFadeStart;\nuniform float geoBuildingFadeEnd;\nvarying vec2 vGeoBuildingCenter;')
      .replace('#include <alphahash_fragment>', `
// Use one threshold in screen space for both LODs. Independent alphaHash
// tests with alpha=t and alpha=1-t leave holes and duplicate coverage.
float geoBuildingDistance = distance(vGeoBuildingCenter, geoBuildingFocus);
${controller.coverage ? detailCoverageLookup('vGeoBuildingCenter') : 'float geoDetailReady = 1.0;'}
float geoBuildingBlend = mix(1.0, smoothstep(geoBuildingFadeStart, geoBuildingFadeEnd, geoBuildingDistance), geoDetailReady);
float geoBuildingThreshold = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
${controller.role === 'far' ? 'if (geoBuildingThreshold >= geoBuildingBlend) discard;\nfloat geoHorizon = 1.0 - smoothstep(3000.0, 4500.0, geoBuildingDistance);\nif (geoBuildingThreshold >= geoHorizon) discard;' : 'if (geoBuildingThreshold < geoBuildingBlend) discard;'}
`)

  }
  material.customProgramCacheKey = () => `${previousKey()}|geographic-building-fade-${controller.role}-650-740-v2-${!!controller.coverage}`
  // Enable the hash shader path, replacing its coverage test above with
  // exactly complementary near/far tests. Keep opaque depth writes.
  material.alphaHash = true
  material.transparent = false
  material.depthWrite = true
  material.needsUpdate = true
}

export interface DistantBuildingOptions {
  /** Source buildings already prepared as static imported/fallback batches. */
  replacedIds?: ReadonlySet<string>
  /** DEM/terrain elevation in the same geographic coordinate system as data. */
  groundAt(x: number, z: number): number | null
  /** Optional water exclusion matches the near renderer's policy. */
  isWater?(x: number, z: number): boolean
  fade?: BuildingFadeController
  regionMetres?: number
}

export interface DistantBuildingStats {
  components: number
  extruded: number
  footprintsOnly: number
  openShelters: number
  parts: number
  skippedNoGround: number
  skippedWater: number
  skippedInvalidGeometry: number
  regions: number
  meshes: number
  vertices: number
  triangles: number
  geometryBytes: number
  prepareMs: number
}

export interface DistantBuildingSet {
  readonly group: THREE.Group
  readonly stats: DistantBuildingStats
  readonly fade: BuildingFadeController
  dispose(): void
}

interface GeometryBucket {
  regionX: number
  regionZ: number
  status: BuildingHeightStatus
  kind: 'building' | 'open-shelter' | 'part'
  positions: number[]
  normals: number[]
  colors: number[]
  centers: number[]
  indices: number[]
  count: number
  sources: Set<string>
}

const ringArea = (ring: GeoPoint[]) => ring.reduce((area, point, index) => {
  const next = ring[(index + 1) % ring.length]
  return area + point.x * next.z - next.x * point.z
}, 0) / 2

function openRing(ring: GeoPoint[]) {
  if (ring.length > 1 && Math.hypot(ring[0].x - ring.at(-1)!.x, ring[0].z - ring.at(-1)!.z) < 0.01) return ring.slice(0, -1)
  return ring
}

const regionCoord = (value: number, size: number) => Math.floor(value / size)
const elapsed = (start: number) => (typeof performance === 'undefined' ? Date.now() : performance.now()) - start

function makeBucket(regionX: number, regionZ: number, status: BuildingHeightStatus, kind: GeometryBucket['kind']): GeometryBucket {
  return { regionX, regionZ, status, kind, positions: [], normals: [], colors: [], centers: [], indices: [], count: 0, sources: new Set() }
}

function addPolygon(bucket: GeometryBucket, feature: Pick<MappedFeature, 'coordinates' | 'holes'>, base: number, top: number, center: GeoPoint, appearance: ReturnType<typeof buildingAppearance>, walls: boolean) {
  const outer = openRing(feature.coordinates)
  const holes = feature.holes.map(openRing).filter(ring => ring.length >= 3)
  if (outer.length < 3 || outer.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.z))) return false
  const shapePoints = [outer, ...holes].map(ring => ring.map(point => new THREE.Vector2(point.x, -point.z)))
  const roofTriangles = THREE.ShapeUtils.triangulateShape(shapePoints[0], shapePoints.slice(1))
  if (!roofTriangles.length) return false
  const colorRoof = new THREE.Color(appearance.roofColor), colorWall = new THREE.Color(appearance.facadeColor)
  const vertex = (point: GeoPoint, y: number, normal: THREE.Vector3, color: THREE.Color) => {
    bucket.positions.push(point.x, y, point.z)
    bucket.normals.push(normal.x, normal.y, normal.z)
    bucket.colors.push(color.r, color.g, color.b)
    bucket.centers.push(center.x, center.z)
    return bucket.positions.length / 3 - 1
  }

  // Triangulation indices are local to the concatenated outer+hole rings.
  // triangulateShape removes closing duplicate points in-place. Build the
  // roof vertex list from those normalized rings so hole indices still line
  // up with the positions sent to BufferGeometry.
  const roofPoints = shapePoints.flatMap(ring => ring.map(point => ({ x: point.x, z: -point.y })))
  const roofOffset = bucket.positions.length / 3
  for (const point of roofPoints) vertex(point, top, new THREE.Vector3(0, 1, 0), colorRoof)
  for (const triangle of roofTriangles) {
    const a = roofOffset + triangle[0], b = roofOffset + triangle[1], c = roofOffset + triangle[2]
    // ShapeUtils works in (x,-z); its CCW triangles become upward-facing in X/Y/Z.
    bucket.indices.push(a, b, c)
  }

  if (walls && top > base) {
    for (const [ringIndex, rawRing] of [outer, ...holes].entries()) {
      const ring = rawRing, area = ringArea(ring)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length]
        const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz)
        if (length < 1e-5) continue
        const isHole = ringIndex > 0
        const orientation = (area > 0) !== isHole ? 1 : -1
        const normal = new THREE.Vector3(dz * orientation / length, 0, -dx * orientation / length)
        const offset = bucket.positions.length / 3
        vertex(a, base, normal, colorWall); vertex(a, top, normal, colorWall)
        vertex(b, base, normal, colorWall); vertex(b, top, normal, colorWall)
        if (orientation > 0) bucket.indices.push(offset, offset + 1, offset + 2, offset + 1, offset + 3, offset + 2)
        else bucket.indices.push(offset, offset + 2, offset + 1, offset + 1, offset + 2, offset + 3)
      }
    }
  }
  bucket.count++
  return true
}

function sourceStatus(feature: MappedFeature): BuildingHeightStatus { return buildingHeight(feature).status }

function appendFeature(bucketMap: Map<string, GeometryBucket>, feature: MappedFeature, groundAt: (x: number, z: number) => number | null, isWater: (x: number, z: number) => boolean, regionSize: number, stats: DistantBuildingStats) {
  const center = { x: (feature.bounds[0] + feature.bounds[2]) / 2, z: (feature.bounds[1] + feature.bounds[3]) / 2 }
  const base = groundAt(center.x, center.z)
  if (base === null || !Number.isFinite(base)) { stats.skippedNoGround++; return }
  if (isWater(center.x, center.z)) { stats.skippedWater++; return }
  const status = sourceStatus(feature)
  const structure = feature.kind === 'building' ? buildingStructureKind(feature) : 'building'
  const kind = structure === 'open-shelter' ? 'open-shelter' : 'building'
  const heightInfo = buildingHeight(feature)
  const hasHeight = heightInfo.metres !== null && Number.isFinite(heightInfo.metres) && heightInfo.metres > 0
  const regionX = regionCoord(center.x, regionSize), regionZ = regionCoord(center.z, regionSize)
  const key = `${regionX},${regionZ}|${status}|${kind}`
  const bucket = bucketMap.get(key) ?? makeBucket(regionX, regionZ, status, kind)
  bucketMap.set(key, bucket)
  // Same documented canopy estimate as the near renderer; no side walls.
  const appearance = buildingAppearance(feature)
  const sourceHeight = Math.min(500, heightInfo.metres ?? 0)
  const minHeight = Number(feature.overtureProperties?.min_height) > 0 ? Number(feature.overtureProperties?.min_height) : 0
  const roofRise = Number(feature.overtureProperties?.roof_height) > 0 ? Math.min(Number(feature.overtureProperties?.roof_height), sourceHeight * 0.45) : 0
  const roof = kind === 'building' && hasHeight && appearance.roofShape === 'pyramidal' && ['source-tag', 'source-estimate'].includes(status)
    ? pyramidalRoof(feature.coordinates, feature.holes, roofRise) : null
  const top = kind === 'open-shelter' ? base + (heightInfo.metres ?? 3.6) : hasHeight ? base + sourceHeight - (roof ? roofRise : 0) - 0.1 : base + 0.12
  const wallBase = hasHeight && kind === 'building' ? base + minHeight - 0.1 : base
  if (hasHeight && kind === 'building' && top - wallBase <= 0.05) { roof?.dispose(); stats.skippedInvalidGeometry++; return }
  if (!hasHeight && kind === 'building') appearance.roofColor = '#87919a'
  if (addPolygon(bucket, feature, wallBase, top, center, appearance, hasHeight && kind === 'building')) {
    if (roof) {
      roof.translate(0, base + sourceHeight - roofRise + 0.025, 0)
      const positions = roof.getAttribute('position'), normals = roof.getAttribute('normal')
      const color = new THREE.Color(appearance.roofColor), offset = bucket.positions.length / 3
      for (let i = 0; i < positions.count; i++) {
        bucket.positions.push(positions.getX(i), positions.getY(i), positions.getZ(i))
        bucket.normals.push(normals.getX(i), normals.getY(i), normals.getZ(i))
        bucket.colors.push(color.r, color.g, color.b); bucket.centers.push(center.x, center.z)
        bucket.indices.push(offset + i)
      }
    }
    bucket.sources.add(String(feature.id));
    if (kind === 'open-shelter') {
      stats.openShelters++
    } else if (hasHeight) stats.extruded++
    else stats.footprintsOnly++
  } else stats.skippedInvalidGeometry++
  roof?.dispose()
}

function appendPart(bucketMap: Map<string, GeometryBucket>, part: MappedBuildingPart, groundAt: (x: number, z: number) => number | null, isWater: (x: number, z: number) => boolean, regionSize: number, stats: DistantBuildingStats) {
  if (part.height === null || !Number.isFinite(part.height) || part.height <= part.minHeight) return
  const center = { x: (part.bounds[0] + part.bounds[2]) / 2, z: (part.bounds[1] + part.bounds[3]) / 2 }
  const base = groundAt(center.x, center.z)
  if (base === null || !Number.isFinite(base)) { stats.skippedNoGround++; return }
  if (isWater(center.x, center.z)) { stats.skippedWater++; return }
  const status: BuildingHeightStatus = part.sourceDatasets.some(source => /microsoft|machine|estimate/i.test(source)) ? 'source-estimate' : 'source-tag'
  const regionX = regionCoord(center.x, regionSize), regionZ = regionCoord(center.z, regionSize)
  const key = `${regionX},${regionZ}|${status}|part`
  const bucket = bucketMap.get(key) ?? makeBucket(regionX, regionZ, status, 'part')
  bucketMap.set(key, bucket)
  const pseudoFeature: MappedFeature = { id: part.id, kind: 'building', tags: {}, coordinates: part.coordinates, holes: part.holes, bounds: part.bounds,
    overtureProperties: { facade_material: part.facadeMaterial, roof_material: part.roofMaterial, facade_color: part.facadeColor, roof_color: part.roofColor, roof_shape: part.roofShape } }
  if (addPolygon(bucket, pseudoFeature, base + part.minHeight, base + Math.min(500, part.height), center, buildingAppearance(pseudoFeature), true)) {
    bucket.sources.add(part.id); stats.parts++
  }
}

/** Build the corridor-wide distant representation once. Batches are indexed
 * by 1024m region and height/structure class; ordinary WebGL frustum culling
 * then rejects whole regions. Unknown heights remain ground-level footprints,
 * and untagged shelters remain open canopy outlines without invented walls. */
export function prepareDistantBuildings(data: Pick<GeoData, 'features' | 'buildingParts'>, options: DistantBuildingOptions): DistantBuildingSet {
  const start = typeof performance === 'undefined' ? Date.now() : performance.now()
  const regionSize = options.regionMetres ?? DISTANT_BUILDING_REGION_METRES
  if (!Number.isFinite(regionSize) || regionSize < 128) throw new Error('远景建筑区域尺寸无效')
  const fade = options.fade ?? createBuildingFadeController('far')
  if (fade.role !== 'far') throw new Error('远景建筑必须使用 far 淡出控制器')
  const stats: DistantBuildingStats = { components: 0, extruded: 0, footprintsOnly: 0, openShelters: 0, parts: 0, skippedNoGround: 0, skippedWater: 0, skippedInvalidGeometry: 0, regions: 0, meshes: 0, vertices: 0, triangles: 0, geometryBytes: 0, prepareMs: 0 }
  const buckets = new Map<string, GeometryBucket>()
  const buildings = data.features.filter(feature => feature.kind === 'building')
  stats.components = buildings.length
  const isWater = options.isWater ?? (() => false)
  for (const feature of buildings) if (!options.replacedIds?.has(String(feature.id))) appendFeature(buckets, feature, options.groundAt, isWater, regionSize, stats)
  for (const part of data.buildingParts) appendPart(buckets, part, options.groundAt, isWater, regionSize, stats)

  const group = new THREE.Group()
  group.name = 'hudson-distant-buildings-1024m'
  const regionKeys = new Set<string>()
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.92, side: THREE.DoubleSide })
  installBuildingDistanceFade(material, fade)
  for (const bucket of buckets.values()) {
    if (!bucket.indices.length) continue
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.normals, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(bucket.colors, 3))
    geometry.setAttribute('geoBuildingCenter', new THREE.Float32BufferAttribute(bucket.centers, 2))
    geometry.setIndex(bucket.indices)
    geometry.computeBoundingSphere()
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = `distant-buildings-${bucket.regionX}-${bucket.regionZ}-${bucket.status}-${bucket.kind}`
    mesh.userData.geoLayer = 'building'
    mesh.userData.geoLod = 'distant'
    mesh.userData.geoHeightSource = bucket.status
    mesh.userData.geoStructureKind = bucket.kind
    mesh.userData.geoComponentCount = bucket.count
    mesh.userData.geoSourceIds = [...bucket.sources]
    mesh.frustumCulled = true
    group.add(mesh)
    regionKeys.add(`${bucket.regionX},${bucket.regionZ}`)
    stats.meshes++
    stats.vertices += geometry.getAttribute('position').count
    stats.triangles += geometry.index!.count / 3
    for (const attribute of Object.values(geometry.attributes)) stats.geometryBytes += attribute.array.byteLength
    stats.geometryBytes += geometry.index!.array.byteLength
  }
  stats.regions = regionKeys.size
  stats.prepareMs = elapsed(start)

  return {
    group, stats, fade,
    dispose() {
      group.traverse(object => {
        if (object instanceof THREE.Mesh) object.geometry.dispose()
      })
      material.dispose()
      group.removeFromParent()
    },
  }
}
