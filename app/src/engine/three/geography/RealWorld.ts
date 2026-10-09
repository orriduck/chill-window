import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { buildingHeight, buildingStructureKind, platformRise, GeoData, type GeoPoint, type MappedFeature, type BuildingHeightStatus } from './GeoData'
import { GeoForest, type ForestPlacement } from './GeoForest'
import { pyramidalRoof } from './GeoRoof'
import { LAND_COVER } from './GeoLandCover'
import { hash01 } from '../core/procedural'
import { groundGrassTex, groundRockTex, geographicTexturesReady } from '../textures'

const TILE = 256
const DETAIL_RADIUS = 3
const CACHE_LIMIT = 256
const PRELOAD_METRES = 1536
const SHELTER_HEIGHT_ESTIMATE = 3.6
// Visually inspected existing 4x2 atlases: A is broadleaf; B cells 0/1/4/5
// have evergreen silhouettes. These are class-level stand-ins, not species IDs.
const BROADLEAF_VARIANTS = [0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 14, 15]
const EVERGREEN_VARIANTS = [8, 9, 12, 13]
const MIXED_VARIANTS = [...BROADLEAF_VARIANTS, ...EVERGREEN_VARIANTS]
interface RealChunk { group: THREE.Group; ground: THREE.Mesh; x: number; z: number }
interface CachedChunk extends RealChunk { lastUsed: number }
const shapeOf = (feature: MappedFeature) => {
  const shape = new THREE.Shape(feature.coordinates.map(p => new THREE.Vector2(p.x, -p.z)))
  for (const hole of feature.holes) shape.holes.push(new THREE.Path(hole.map(p => new THREE.Vector2(p.x, -p.z))))
  return shape
}
const overlaps = (f: MappedFeature, x: number, z: number) => f.bounds[0] <= x + TILE && f.bounds[2] >= x && f.bounds[1] <= z + TILE && f.bounds[3] >= z

/** Batch all roof faces and all walls separately. One material group per
 * building defeats merging, while no groups makes material-array parts
 * invisible. Both roof and wall now draw once per source class and tile. */
const mergeBuildingGeometry = (geometries: THREE.BufferGeometry[]) => {
  const merged = mergeGeometries(geometries, false)
  if (!merged) return null
  const caps: number[] = [], walls: number[] = []
  let vertexOffset = 0
  for (const geometry of geometries) {
    for (const group of geometry.groups) {
      const target = group.materialIndex === 0 ? caps : walls
      for (let i = group.start; i < group.start + group.count; i++) target.push(vertexOffset + (geometry.index?.getX(i) ?? i))
    }
    vertexOffset += geometry.getAttribute('position').count
  }
  merged.setIndex([...caps, ...walls]); merged.clearGroups()
  merged.addGroup(0, caps.length, 0); merged.addGroup(caps.length, walls.length, 1)
  return merged
}

/** A source-backed world, kept in fixed geographical metres. Only the parent
 * transform follows the train: geometry and UVs never move relative to GIS. */
export class RealWorld {
  readonly group = new THREE.Group()
  readonly routeLine: THREE.Line
  readonly marker = new THREE.Mesh(new THREE.ConeGeometry(7, 20, 4), new THREE.MeshBasicMaterial({ color: 0xe4b654, depthTest: false }))
  private chunks = new Map<string, CachedChunk>()
  private initialKeys = new Set<string>()
  private assetsReady = false
  private readyResolved = false
  private resolveReady!: () => void
  private rejectReady!: (error: Error) => void
  readonly ready: Promise<void>
  private background: THREE.Group | null = null
  private landMask: THREE.CanvasTexture
  private landSourceMap: THREE.CanvasTexture
  private landSourceMode = { value: 0 }
  private landPixels!: Uint8ClampedArray
  private forest = new GeoForest()
  private distantForest = new GeoForest('far')
  private distantForestGroup = new THREE.Group()
  private textureFailures = 0
  presentable = false
  private disposed = false
  private frame = 0
  private waterGroup = new THREE.Group()
  private stationGroup = new THREE.Group()
  private groundMaterial: THREE.MeshStandardMaterial
  private outlineMaterial = new THREE.LineBasicMaterial({ color: 0xf1e8c2, transparent: true, opacity: 0.7, depthTest: false })
  private roadMaterial = new THREE.MeshStandardMaterial({ color: 0x747570, roughness: 1 })
  private ballastMaterial = new THREE.MeshStandardMaterial({ color: 0x948d7c, roughness: 1 })
  private railMaterial = new THREE.MeshStandardMaterial({ color: 0x9b9f9e, roughness: 0.5, metalness: 0.5 })
  private roofMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, vertexColors: true, side: THREE.DoubleSide })
  private shelterSupportGeometry = new THREE.CylinderGeometry(0.075, 0.075, 1, 6)
  private shelterSupportMaterial = new THREE.MeshStandardMaterial({ color: 0x59645f, roughness: 0.9 })
  private shelterOutlineMaterial = new THREE.LineBasicMaterial({ color: 0x58645e, depthTest: true })
  private platformMaterial = new THREE.MeshStandardMaterial({ color: 0x737b77, roughness: 0.88, side: THREE.DoubleSide })
  private platformOutlineMaterial = new THREE.LineBasicMaterial({ color: 0xe6c786, depthTest: false, transparent: true, opacity: 0.9 })
  private wallMaterial = new THREE.MeshStandardMaterial({ color: 0xb0aea3, roughness: 1 })
  private taggedWallMaterial = new THREE.MeshStandardMaterial({ color: 0x74906d, roughness: 1 })
  private estimatedWallMaterial = new THREE.MeshStandardMaterial({ color: 0xc9894f, roughness: 1 })
  private floorsOnlyWallMaterial = new THREE.MeshStandardMaterial({ color: 0x8f79a7, roughness: 1 })
  private footprintMaterial = new THREE.MeshStandardMaterial({ color: 0x87919a, roughness: 1, side: THREE.DoubleSide })
  private tieMaterial = new THREE.MeshStandardMaterial({ color: 0x736353, roughness: 1 })
  private engineeringGeometry = new THREE.BoxGeometry(1, 1, 1)
  private engineeringMaterial = new THREE.MeshStandardMaterial({ color: 0x656963, roughness: 1 })
  private tieGeometry = new THREE.BoxGeometry(2.5, 0.14, 0.22)
  private rails: { a: GeoPoint; b: GeoPoint; s: number; end: number }[] = []
  pending = 0
  get chunkCount() { return this.chunks.size }
  get assetStatus() { return this.textureFailures ? `纹理 ${this.textureFailures} 失败` : this.assetsReady ? '地表 / 树木纹理就绪' : '加载地表 / 树木纹理' }
  private nearestMissingMetres = PRELOAD_METRES
  private lastBuildMs = 0
  private maxBuildMs = 0
  private visibleMissing = 0
  private suddenAppearanceFrames = 0
  private prefetchPending = 0
  private preparationTarget: number | null = null
  private advanceTarget: number | null = null
  get streamingStats() {
    return { cached: this.chunks.size, visible: [...this.chunks.values()].filter(c => c.group.visible).length,
      pending: this.pending, preloadMetres: PRELOAD_METRES, nearestMissingMetres: this.nearestMissingMetres,
      lastBuildMs: this.lastBuildMs, maxBuildMs: this.maxBuildMs, visibleMissing: this.visibleMissing,
      suddenAppearanceFrames: this.suddenAppearanceFrames, assets: this.assetStatus, ready: this.presentable, prefetchPending: this.prefetchPending }
  }
  get visibleTiles() { return [...this.chunks.values()].map(c => ({ x: c.x, z: c.z, mesh: c.ground })) }

  readonly data: GeoData
  constructor(data: GeoData, initialS = data.checkpoints[0]?.s ?? 0) {
    this.data = data
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject })
    this.landMask = this.buildLandMask()
    this.landSourceMap = this.buildLandSourceMap()
    this.group.name = 'real-hudson-world'
    this.groundMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, map: groundGrassTex, roughness: 0.95 })
    this.groundMaterial.onBeforeCompile = shader => {
      shader.uniforms.geoRock = { value: groundRockTex }
      shader.uniforms.geoLandMask = { value: this.landMask }
      shader.uniforms.geoLandSourceMap = { value: this.landSourceMap }
      shader.uniforms.geoLandSourceMode = this.landSourceMode
      shader.uniforms.geoBounds = { value: new THREE.Vector4(...data.bundle.dem.bounds) }
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 geoPosition;\nvarying vec3 geoNormal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ngeoPosition = position; geoNormal = normal;')
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D geoRock;\nuniform sampler2D geoLandMask;\nuniform sampler2D geoLandSourceMap;\nuniform float geoLandSourceMode;\nuniform vec4 geoBounds;\nvarying vec3 geoPosition;\nvarying vec3 geoNormal;')
        .replace('#include <map_fragment>', `
#ifdef USE_MAP
vec2 landUv = (geoPosition.xz - geoBounds.xy) / (geoBounds.zw - geoBounds.xy);
vec4 land = texture2D(geoLandMask, landUv);
if (land.r > 0.5) discard;
diffuseColor.rgb *= mix(vec3(1.0),vec3(0.58,0.76,0.54),land.g);
vec3 n = normalize(geoNormal);
vec3 blend = pow(abs(n), vec3(4.0)); blend /= max(dot(blend,vec3(1.0)),0.001);
vec3 rock = texture2D(geoRock,geoPosition.zy*0.055).rgb*blend.x + texture2D(geoRock,geoPosition.xz*0.055).rgb*blend.y + texture2D(geoRock,geoPosition.xy*0.055).rgb*blend.z;
vec3 grass = texture2D(map,geoPosition.xz*0.085).rgb;
diffuseColor.rgb *= mix(grass*1.1,rock,smoothstep(0.13,0.5,1.0-abs(n.y)));
if (geoLandSourceMode > 0.5) diffuseColor.rgb = texture2D(geoLandSourceMap, landUv).rgb;
#endif`)
    }
    this.groundMaterial.customProgramCacheKey = () => 'geographic-terrain-nlcd-v3'
    for (let s = 0; s < data.length; s += 4) this.rails.push({ a: data.pose(s), b: data.pose(Math.min(data.length, s + 4)), s, end: Math.min(data.length, s + 4) })
    const points = data.points.map((p, i) => new THREE.Vector3(p.x, data.railHeight(data.distances[i]) + 1.5, p.z))
    this.routeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xf0c66b, depthTest: false }))
    this.routeLine.renderOrder = 100
    this.marker.rotation.x = Math.PI; this.marker.renderOrder = 110
    this.group.add(this.routeLine, this.marker, this.waterGroup)
    const [minX, minZ, maxX, maxZ] = data.bundle.dem.bounds
    this.background = new THREE.Group()
    this.background.name = 'whole-corridor-dem-low-detail'
    // Fixed 64m source grid, prepared once. Separate patches allow normal
    // frustum culling instead of submitting the entire 448km² footprint.
    for (let x = minX; x < maxX; x += 1024) for (let z = minZ; z < maxZ; z += 1024) {
      const mesh = new THREE.Mesh(this.terrainGeometry(x, z, Math.min(1024, maxX - x), Math.min(1024, maxZ - z), 64), this.groundMaterial)
      mesh.receiveShadow = true; this.background.add(mesh)
    }
    this.group.add(this.background)
    this.buildWater()
    this.buildStations()
    this.buildDistantForest()
    this.initialKeys = this.initialPreloadKeys(initialS)
    // Shared assets are loaded before any chunks are meshed. Asset completion
    // never clears an already visible tile or triggers a second rebuild.
    void geographicTexturesReady.then(results => {
      if (this.disposed) return
      this.textureFailures = results.filter(loaded => !loaded).length
      this.assetsReady = this.textureFailures === 0
      if (this.textureFailures) this.rejectReady(new Error(`地表 / 树木纹理有 ${this.textureFailures} 项加载失败，请刷新重试`))
    })
  }
  private tilesAt(x: number, z: number) {
    const tiles = new Map<string, { x: number; z: number }>()
    const bx = Math.floor(x / TILE), bz = Math.floor(z / TILE)
    for (let dz = -DETAIL_RADIUS; dz <= DETAIL_RADIUS; dz++) for (let dx = -DETAIL_RADIUS; dx <= DETAIL_RADIUS; dx++) {
      const tile = { x: bx + dx, z: bz + dz }
      tiles.set(`${tile.x},${tile.z}`, tile)
    }
    return tiles
  }
  private initialPreloadKeys(s: number) {
    const keys = new Set<string>()
    // Prepare the entire first view AND the same-width route buffer. A
    // narrow three-tile strip does not cover a seven-tile moving viewport.
    for (let ahead = 0; ahead <= PRELOAD_METRES; ahead += TILE) {
      const p = this.data.pose(Math.min(this.data.length, s + ahead))
      for (const key of this.tilesAt(p.x, p.z).keys()) keys.add(key)
    }
    return keys
  }
  canAdvance(s: number) {
    if (!this.presentable) return false
    const pose = this.data.pose(s)
    return [...this.tilesAt(pose.x, pose.z).keys()].every(key => this.chunks.has(key))
  }
  prepareAt(s: number | null) { this.preparationTarget = s }
  prepareAdvance(s: number | null) { this.advanceTarget = s }
  /** Rail-bed correction is a narrow engineering visualization, not a new
   * geographical landform. Bridges/tunnels keep their ground DEM below/above. */
  terrainHeight(x: number, z: number) {
    const raw = this.data.heightAt(x, z)
    if (raw === null) return null
    const near = this.data.railProximity(x, z)
    if (near.distance < 18 && !this.data.engineeringAt(x, z)) {
      const t = THREE.MathUtils.smoothstep(near.distance, 4, 18)
      return THREE.MathUtils.lerp(this.data.railHeight(near.s) - 0.25, raw, t)
    }
    return raw
  }
  update(s: number, inspection: boolean, focus: THREE.Vector3, layers: { ground: boolean; vegetation: boolean; settlements: boolean; water: boolean; farmland: boolean; stations?: boolean; sourceLandCover?: boolean }) {
    const pose = this.data.pose(s)
    this.group.visible = this.presentable || inspection
    if (inspection) { this.group.position.set(0, 0, 0); this.group.rotation.y = 0 }
    else {
      this.group.rotation.y = -pose.heading
      this.group.position.set(-pose.dz * pose.x + pose.dx * pose.z, 0, s - pose.dx * pose.x - pose.dz * pose.z)
    }
    this.routeLine.visible = this.marker.visible = inspection
    this.marker.position.set(pose.x, this.data.railHeight(s) + 22, pose.z)
    this.waterGroup.visible = layers.water
    this.stationGroup.visible = layers.stations ?? true
    const point = inspection ? focus : pose
    this.landSourceMode.value = inspection && layers.sourceLandCover ? 1 : 0
    this.forest.setFocus(point.x, point.z); this.distantForest.setFocus(point.x, point.z)
    this.distantForestGroup.visible = layers.vegetation
    // Everything is already prepared. Skip distant instance batches that are
    // entirely outside the shader's fade range without evicting/rebuilding them.
    for (const child of this.distantForestGroup.children) if (child instanceof THREE.InstancedMesh && child.boundingSphere) {
      const sphere = child.boundingSphere
      child.visible = Math.hypot(sphere.center.x - point.x, sphere.center.z - point.z) - sphere.radius < 4500
    }
    const wanted = this.tilesAt(point.x, point.z)
    const currentS = inspection ? this.data.nearestRoute(point.x, point.z).s : s
    const required = new Map(wanted)
    // Keep the active ride prepared while inspecting unrelated places. Esc
    // must not expose missing buildings after the map has evicted old chunks.
    if (inspection) for (const [key, tile] of this.tilesAt(pose.x, pose.z)) required.set(key, tile)
    for (let offset = 0; offset <= PRELOAD_METRES; offset += TILE) {
      const ahead = this.data.pose(Math.min(this.data.length, currentS + offset))
      for (const [key, tile] of this.tilesAt(ahead.x, ahead.z)) required.set(key, tile)
    }
    const preparing = this.preparationTarget === null ? null : this.data.pose(this.preparationTarget)
    if (preparing) for (const [key, tile] of this.tilesAt(preparing.x, preparing.z)) required.set(key, tile)
    if (this.advanceTarget !== null) {
      const next = this.data.pose(this.advanceTarget)
      // A bend between the 256m route samples may enter a corner tile that
      // none of those samples cover. Always queue the exact motion target,
      // or the coverage guard could hold the train without building it.
      for (const [key, tile] of this.tilesAt(next.x, next.z)) required.set(key, tile)
    }
    const missing = [...required.entries()].filter(([key]) => !this.chunks.has(key))
      .map(([key, tile]) => {
        const centerX = (tile.x + 0.5) * TILE, centerZ = (tile.z + 0.5) * TILE
        const route = inspection ? this.data.nearestRoute(centerX, centerZ) : null
        const distance = preparing ? Math.hypot(centerX - preparing.x, centerZ - preparing.z) : route && route.distance < 420
          ? Math.abs(route.s - currentS) * 0.3 + route.distance
          : Math.hypot(centerX - point.x, centerZ - point.z)
        return { key, tile, distance }
      }).sort((a, b) => a.distance - b.distance)
    this.pending = [...wanted.keys()].filter(key => !this.chunks.has(key)).length
    this.visibleMissing = this.pending
    if (this.presentable && !inspection && this.visibleMissing) this.suddenAppearanceFrames++
    this.prefetchPending = missing.length
    this.nearestMissingMetres = missing.length ? Math.round(missing[0].distance) : PRELOAD_METRES
    // Tile creation is time-sliced across animation frames; the current view
    // has priority, followed by the route-aligned safety buffer.
    if (this.assetsReady && missing.length) {
      const { key, tile } = missing[0], started = performance.now()
      const created = this.createChunk(tile.x, tile.z)
      this.lastBuildMs = performance.now() - started
      this.maxBuildMs = Math.max(this.maxBuildMs, this.lastBuildMs)
      created.group.visible = false
      this.chunks.set(key, { ...created, lastUsed: this.frame })
    }
    for (const chunk of this.chunks.values()) {
      const key = `${chunk.x},${chunk.z}`
      chunk.group.visible = wanted.has(key)
      if (chunk.group.visible) chunk.lastUsed = this.frame
      chunk.ground.visible = layers.ground
      for (const child of chunk.group.children) {
        const layer = child.userData.geoLayer
        if (layer === 'vegetation') child.visible = layers.vegetation
        if (layer === 'settlement') {
          child.visible = layers.settlements
          if (child instanceof THREE.Mesh && Array.isArray(child.material) && child.userData.geoHeightSource) {
            const estimate = ['source-estimate', 'estimated-from-levels'].includes(child.userData.geoHeightSource)
            child.material[1] = inspection ? (estimate ? this.estimatedWallMaterial : this.taggedWallMaterial) : this.wallMaterial
          }
        }
        if (layer === 'farmland') child.visible = layers.farmland
        if (layer === 'inspection') child.visible = inspection
      }
    }
    if (!this.readyResolved && [...this.initialKeys].every(key => this.chunks.has(key))) {
      this.readyResolved = true
      this.resolveReady()
    }
    const cachedOutsideView = [...this.chunks.entries()].filter(([key]) => !required.has(key)).sort((a, b) => a[1].lastUsed - b[1].lastUsed)
    while (this.chunks.size > CACHE_LIMIT && cachedOutsideView.length) {
      const [key, chunk] = cachedOutsideView.shift()!
      this.disposeChunk(chunk); this.chunks.delete(key)
    }
    if (this.background) this.background.visible = layers.ground
    this.frame++
  }
  private terrainGeometry(minX: number, minZ: number, width: number, depth: number, step: number, excluded?: { minX: number; minZ: number; maxX: number; maxZ: number }) {
    const cols = Math.round(width / step), rows = Math.round(depth / step)
    const positions: number[] = [], colors: number[] = [], normals: number[] = [], uv: number[] = [], indices: number[] = [], valid: boolean[] = []
    for (let row = 0; row <= rows; row++) for (let col = 0; col <= cols; col++) {
      const x = minX + col * step, z = minZ + row * step
      const h = this.terrainHeight(x, z)
      valid.push(h !== null); positions.push(x, h ?? 0, z); uv.push(x * 0.08, z * 0.08)
      const hx0 = this.terrainHeight(x - 4, z) ?? h ?? 0, hx1 = this.terrainHeight(x + 4, z) ?? h ?? 0
      const hz0 = this.terrainHeight(x, z - 4) ?? h ?? 0, hz1 = this.terrainHeight(x, z + 4) ?? h ?? 0
      const normal = new THREE.Vector3(hx0 - hx1, 8, hz0 - hz1).normalize(); normals.push(normal.x, normal.y, normal.z)
      const { forest, farm } = this.sampleLand(x, z)
      const tint = new THREE.Color(forest ? 0xabb49a : farm ? 0xc8c092 : 0xc4c4aa)
      tint.multiplyScalar(0.97 + hash01(Math.floor(x / 20), Math.floor(z / 20)) * 0.06)
      colors.push(tint.r, tint.g, tint.b)
    }
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const x = minX + (col + 0.5) * step, z = minZ + (row + 0.5) * step
      if (excluded && x > excluded.minX && x < excluded.maxX && z > excluded.minZ && z < excluded.maxZ) continue
      const a = row * (cols + 1) + col, b = a + 1, c = a + cols + 1, d = c + 1
      if (valid[a] && valid[b] && valid[c]) indices.push(a, c, b)
      if (valid[b] && valid[c] && valid[d]) indices.push(b, c, d)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices)
    return geometry
  }
  private createChunk(cx: number, cz: number): RealChunk {
    const group = new THREE.Group(), x0 = cx * TILE, z0 = cz * TILE
    const ground = new THREE.Mesh(this.terrainGeometry(x0, z0, TILE, TILE, 8), this.groundMaterial)
    ground.position.y = 0.18
    ground.receiveShadow = true; group.add(ground)
    const outline: THREE.Vector3[] = []
    for (let side = 0; side < 4; side++) for (let i = 0; i <= 32; i++) {
      const t = i * 8, x = x0 + (side === 0 ? t : side === 1 ? TILE : side === 2 ? TILE - t : 0), z = z0 + (side === 0 ? 0 : side === 1 ? t : side === 2 ? TILE : TILE - t)
      outline.push(new THREE.Vector3(x, (this.terrainHeight(x, z) ?? 0) + 0.7, z))
    }
    const edge = new THREE.Line(new THREE.BufferGeometry().setFromPoints(outline), this.outlineMaterial)
    edge.userData.geoLayer = 'inspection'; edge.renderOrder = 90; group.add(edge)
    const features = this.data.nearbyFeatures(x0 + 128, z0 + 128)
    const buildings = features.filter(f => f.kind === 'building' && Math.floor((f.bounds[0] + f.bounds[2]) / 2 / TILE) === cx && Math.floor((f.bounds[1] + f.bounds[3]) / 2 / TILE) === cz)
    const buildingGeometry = new Map<BuildingHeightStatus, THREE.BufferGeometry[]>([['tagged', []], ['estimated-from-levels', []], ['source-tag', []], ['source-estimate', []]])
    const roofGeometry = new Map<BuildingHeightStatus, THREE.BufferGeometry[]>([['source-tag', []], ['source-estimate', []]])
    const missingFootprints: THREE.BufferGeometry[] = []
    for (const feature of buildings) {
      const x = (feature.bounds[0] + feature.bounds[2]) / 2, z = (feature.bounds[1] + feature.bounds[3]) / 2
      const base = this.terrainHeight(x, z)
      if (base === null || this.data.landAt(x, z, 'water')) continue
      const measurement = buildingHeight(feature)
      if (buildingStructureKind(feature) === 'open-shelter') {
        // OSM's shelter tags and Overture's class describe an open-sided
        // canopy, even when `building=yes` is also present. Heights absent
        // from both sources stay labelled as an explicit visual estimate;
        // perimeter walls are never substituted for the missing value.
        const height = measurement.metres ?? SHELTER_HEIGHT_ESTIMATE
        const roof = new THREE.ShapeGeometry(shapeOf(feature))
        const roofColor = feature.overtureProperties?.roof_color
        const color = new THREE.Color(typeof roofColor === 'string' && /^#[0-9a-f]{6}$/i.test(roofColor) ? roofColor : 0x77817c)
        const colors: number[] = []
        for (let i = 0; i < roof.getAttribute('position').count; i++) colors.push(color.r, color.g, color.b)
        roof.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
        roof.rotateX(-Math.PI / 2); roof.translate(0, base + height, 0)
        const canopy = new THREE.Mesh(roof, this.roofMaterial)
        canopy.userData.geoLayer = 'settlement'; canopy.userData.geoStructureKind = 'open-shelter'
        canopy.userData.geoSourceId = String(feature.id); canopy.userData.geoHeightSource = measurement.status
        canopy.userData.geoHeightEstimateMetres = measurement.metres === null ? height : undefined
        canopy.renderOrder = 6; group.add(canopy)

        const ring = [...feature.coordinates]
        if (ring.length > 1 && Math.hypot(ring[0].x - ring.at(-1)!.x, ring[0].z - ring.at(-1)!.z) < 0.5) ring.pop()
        const perimeter = ring.reduce((sum, point, index) => {
          const next = ring[(index + 1) % ring.length]
          return sum + Math.hypot(next.x - point.x, next.z - point.z)
        }, 0)
        const supportCount = Math.max(2, Math.ceil(perimeter / 14))
        const supports = new THREE.InstancedMesh(this.shelterSupportGeometry, this.shelterSupportMaterial, supportCount)
        const supportMatrix = new THREE.Object3D()
        for (let i = 0; i < supportCount; i++) {
          let remaining = perimeter * i / supportCount, point = ring[0]
          for (let segment = 0; segment < ring.length; segment++) {
            const from = ring[segment], to = ring[(segment + 1) % ring.length], length = Math.hypot(to.x - from.x, to.z - from.z)
            if (remaining <= length || segment === ring.length - 1) {
              const fraction = length > 0 ? Math.min(1, remaining / length) : 0
              point = { x: THREE.MathUtils.lerp(from.x, to.x, fraction), z: THREE.MathUtils.lerp(from.z, to.z, fraction) }
              break
            }
            remaining -= length
          }
          supportMatrix.position.set(point.x, base + height / 2, point.z)
          supportMatrix.scale.set(1, height, 1); supportMatrix.updateMatrix(); supports.setMatrixAt(i, supportMatrix.matrix)
        }
        supports.instanceMatrix.needsUpdate = true
        supports.userData.geoLayer = 'settlement'; supports.userData.geoStructureKind = 'open-shelter'
        supports.userData.geoSourceId = String(feature.id); supports.userData.geoStructurePartsAreEstimates = true
        supports.userData.sharedGeometry = true; group.add(supports)
        const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring.map(point => new THREE.Vector3(point.x, base + height + 0.025, point.z))), this.shelterOutlineMaterial)
        outline.userData.geoLayer = 'settlement'; outline.userData.geoStructureKind = 'open-shelter'; outline.userData.geoSourceId = String(feature.id)
        group.add(outline)
        continue
      }
      if (measurement.status === 'missing' || measurement.status === 'floors-only') {
        const footprint = new THREE.ShapeGeometry(shapeOf(feature)); footprint.rotateX(-Math.PI / 2); footprint.translate(0, base + 0.12, 0)
        missingFootprints.push(footprint)
        continue
      }
      const properties = feature.overtureProperties ?? {}
      const minHeight = Number(properties.min_height) > 0 ? Number(properties.min_height) : 0
      const top = Math.min(500, measurement.metres!)
      const roofHeight = Number(properties.roof_height) > 0 ? Math.min(Number(properties.roof_height), top * 0.45) : 0
      const roofShape = properties.roof_shape ?? feature.tags['roof:shape'] ?? feature.tags['building:roof:shape']
      const roofMesh = roofShape === 'pyramidal' && (measurement.status === 'source-tag' || measurement.status === 'source-estimate')
        ? pyramidalRoof(feature.coordinates, feature.holes, roofHeight) : null
      const modeledRoof = roofMesh !== null
      const depth = top - minHeight - (modeledRoof ? roofHeight : 0)
      if (depth <= 0.05) { roofMesh?.dispose(); continue }
      const geometry = new THREE.ExtrudeGeometry(shapeOf(feature), { depth, bevelEnabled: false, steps: 1 })
      // ExtrudeGeometry's first material is the roof and second is the wall.
      // Source roof metadata is kept with each building; the base palettes
      // distinguish recorded heights from upstream model estimates.
      const roofColor = typeof properties.roof_color === 'string' && /^#[0-9a-f]{6}$/i.test(properties.roof_color) ? properties.roof_color : null
      const color = new THREE.Color(roofColor ?? 0x72756f), colors: number[] = []
      for (let i = 0; i < geometry.getAttribute('position').count; i++) colors.push(color.r, color.g, color.b)
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      geometry.rotateX(-Math.PI / 2); geometry.translate(0, base + minHeight - 0.1, 0)
      geometry.userData.roofShape = roofShape
      buildingGeometry.get(measurement.status)!.push(geometry)
      if (modeledRoof && (measurement.status === 'source-tag' || measurement.status === 'source-estimate')) {
        const roof = roofMesh!
        const positions = roof.getAttribute('position')
        const color = new THREE.Color(roofColor ?? 0x72756f), colors: number[] = []
        for (let i = 0; i < positions.count; i++) colors.push(color.r, color.g, color.b)
        roof.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
        roof.translate(0, base + top - roofHeight + 0.025, 0)
        roofGeometry.get(measurement.status)!.push(roof)
      }
    }
    for (const [status, geometries] of buildingGeometry) {
      if (!geometries.length) continue
      const merged = mergeBuildingGeometry(geometries)
      if (merged) {
        const wall = status === 'estimated-from-levels' || status === 'source-estimate' ? this.estimatedWallMaterial : status === 'floors-only' ? this.floorsOnlyWallMaterial : this.wallMaterial
        const mesh = new THREE.Mesh(merged, [this.roofMaterial, wall]); mesh.userData.geoLayer = 'settlement'; mesh.userData.geoHeightSource = status; mesh.receiveShadow = true; group.add(mesh)
      }
      for (const geometry of geometries) geometry.dispose()
    }
    for (const [status, geometries] of roofGeometry) {
      if (!geometries.length) continue
      const merged = mergeGeometries(geometries, false)
      if (merged) {
        const mesh = new THREE.Mesh(merged, this.roofMaterial)
        mesh.userData.geoLayer = 'settlement'; mesh.userData.geoHeightSource = status; mesh.userData.geoRoofShapeSource = true
        group.add(mesh)
      }
      geometries.forEach(geometry => geometry.dispose())
    }
    if (missingFootprints.length) {
      const merged = mergeGeometries(missingFootprints, false)
      for (const geometry of missingFootprints) geometry.dispose()
      if (merged) { const mesh = new THREE.Mesh(merged, this.footprintMaterial); mesh.userData.geoLayer = 'settlement'; mesh.userData.geoHeightSource = 'missing'; group.add(mesh) }
    }
    const partGeometry = new Map<BuildingHeightStatus, THREE.BufferGeometry[]>([['source-tag', []], ['source-estimate', []]])
    for (const part of this.data.buildingParts.filter(item => item.bounds[0] <= x0 + TILE && item.bounds[2] >= x0 && item.bounds[1] <= z0 + TILE && item.bounds[3] >= z0 && Math.floor((item.bounds[0] + item.bounds[2]) / 2 / TILE) === cx && Math.floor((item.bounds[1] + item.bounds[3]) / 2 / TILE) === cz)) {
      const base = this.terrainHeight((part.bounds[0] + part.bounds[2]) / 2, (part.bounds[1] + part.bounds[3]) / 2)
      if (base === null || part.height === null || part.height <= part.minHeight) continue
      const feature: MappedFeature = { id: part.id, kind: 'building', tags: {}, coordinates: part.coordinates, holes: part.holes, bounds: part.bounds }
      const shape = shapeOf(feature)
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: Math.min(500, part.height - part.minHeight), bevelEnabled: false, steps: 1 })
      const color = new THREE.Color(part.roofColor && /^#[0-9a-f]{6}$/i.test(part.roofColor) ? part.roofColor : 0x72756f), colors: number[] = []
      for (let i = 0; i < geometry.getAttribute('position').count; i++) colors.push(color.r, color.g, color.b)
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      geometry.rotateX(-Math.PI / 2); geometry.translate(0, base + part.minHeight, 0)
      partGeometry.get('source-tag')!.push(geometry)
    }
    for (const [status, geometries] of partGeometry) {
      if (!geometries.length) continue
      const merged = mergeBuildingGeometry(geometries)
      if (merged) {
        const mesh = new THREE.Mesh(merged, [this.roofMaterial, this.wallMaterial])
        mesh.userData.geoLayer = 'settlement'; mesh.userData.geoHeightSource = status; mesh.userData.geoBuildingParts = geometries.length
        mesh.userData.geoSource = 'Overture building_part'; mesh.receiveShadow = true; group.add(mesh)
      }
      geometries.forEach(geometry => geometry.dispose())
    }
    for (const f of features) if (f.kind === 'road' && overlaps(f, x0, z0)) {
      const width = /motorway|trunk/.test(f.tags.highway ?? '') ? 8 : /primary|secondary/.test(f.tags.highway ?? '') ? 5 : 3
      const mesh = this.ribbon(f.coordinates, width, (x, z) => this.terrainHeight(x, z), x0, z0, this.roadMaterial)
      if (mesh) { mesh.userData.geoLayer = 'settlement'; group.add(mesh) }
    }
    this.addTracks(group, x0, z0)
    this.addVegetation(group, x0, z0)
    this.group.add(group)
    return { group, ground, x: cx, z: cz }
  }
  private ribbon(points: GeoPoint[], width: number, height: (x: number, z: number) => number | null, x0: number, z0: number, material: THREE.Material) {
    const vertices: number[] = []
    const sampled: GeoPoint[] = []
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 16))
      if (i === 1) sampled.push(a)
      for (let j = 1; j <= steps; j++) sampled.push({ x: THREE.MathUtils.lerp(a.x, b.x, j / steps), z: THREE.MathUtils.lerp(a.z, b.z, j / steps) })
    }
    for (let i = 1; i < sampled.length; i++) {
      const a = sampled[i - 1], b = sampled[i], mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2
      if (mx < x0 || mx >= x0 + TILE || mz < z0 || mz >= z0 + TILE) continue
      const length = Math.hypot(b.x - a.x, b.z - a.z)
      if (!length) continue
      const nx = (b.z - a.z) / length * width / 2, nz = -(b.x - a.x) / length * width / 2
      const corners = [[a.x - nx, a.z - nz], [a.x + nx, a.z + nz], [b.x - nx, b.z - nz], [b.x + nx, b.z + nz]]
      const ys = corners.map(([x, z]) => height(x, z))
      if (ys.some(y => y === null)) continue
      for (const index of [0, 2, 1, 1, 2, 3]) vertices.push(corners[index][0], ys[index]! + 0.12, corners[index][1])
    }
    if (!vertices.length) return null
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.computeVertexNormals()
    const mesh = new THREE.Mesh(geometry, material); mesh.receiveShadow = true
    return mesh
  }
  private addTracks(group: THREE.Group, x0: number, z0: number) {
    const engineering: THREE.Matrix4[] = []
    const ties: THREE.Matrix4[] = [], matrix = new THREE.Object3D(), ballast: number[] = [], rails: number[] = []
    for (const segment of this.rails) {
      const { a, b, s, end } = segment, mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2
      if (mx < x0 || mx >= x0 + TILE || mz < z0 || mz >= z0 + TILE) continue
      const poseA = this.data.pose(s), poseB = this.data.pose(end)
      const center = this.data.pose((s + end) / 2), type = this.data.engineeringKindAt(center.x, center.z)
      const block = (offset: number, rise: number, width: number, height: number) => {
        matrix.position.set(center.x + center.dz * offset, this.data.railHeight((s + end) / 2) + rise, center.z - center.dx * offset)
        matrix.rotation.set(0, center.heading, 0); matrix.scale.set(width, height, end - s + 0.2); matrix.updateMatrix(); engineering.push(matrix.matrix.clone())
      }
      if (type === 'tunnel') { block(-3.8, 1.5, 0.35, 9); block(3.8, 1.5, 0.35, 9); block(0, 6, 8, 0.4); block(0, -0.5, 8, 0.4) }
      else if (type === 'bridge') block(0, -0.45, 5.5, 0.5)
      const strip = (center: number, width: number, rise: number, output: number[]) => {
        const corners = [
          [a.x + poseA.dz * (center - width / 2), this.data.railHeight(s) + rise, a.z - poseA.dx * (center - width / 2)],
          [a.x + poseA.dz * (center + width / 2), this.data.railHeight(s) + rise, a.z - poseA.dx * (center + width / 2)],
          [b.x + poseB.dz * (center - width / 2), this.data.railHeight(end) + rise, b.z - poseB.dx * (center - width / 2)],
          [b.x + poseB.dz * (center + width / 2), this.data.railHeight(end) + rise, b.z - poseB.dx * (center + width / 2)],
        ]
        for (const i of [0, 2, 1, 1, 2, 3]) output.push(...corners[i])
      }
      strip(0, 5, -0.15, ballast); strip(-0.7175, 0.08, 0.15, rails); strip(0.7175, 0.08, 0.15, rails)
      for (let distance = s; distance < end; distance += 0.8) {
        const p = this.data.pose(distance)
        matrix.position.set(p.x, this.data.railHeight(distance), p.z); matrix.rotation.set(0, p.heading, 0); matrix.scale.set(1, 1, 1); matrix.updateMatrix(); ties.push(matrix.matrix.clone())
      }
    }
    for (const [values, material] of [[ballast, this.ballastMaterial], [rails, this.railMaterial]] as const) if (values.length) {
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(values, 3)); geometry.computeVertexNormals(); group.add(new THREE.Mesh(geometry, material))
    }
    if (engineering.length) {
      const mesh = new THREE.InstancedMesh(this.engineeringGeometry, this.engineeringMaterial, engineering.length); mesh.userData.sharedGeometry = true
      for (let i = 0; i < engineering.length; i++) mesh.setMatrixAt(i, engineering[i])
      mesh.computeBoundingSphere(); group.add(mesh)
    }
    if (ties.length) {
      const mesh = new THREE.InstancedMesh(this.tieGeometry, this.tieMaterial, ties.length)
      mesh.userData.sharedGeometry = true
      for (let i = 0; i < ties.length; i++) mesh.setMatrixAt(i, ties[i])
      mesh.computeBoundingSphere(); group.add(mesh)
    }
  }
  private addVegetation(group: THREE.Group, x0: number, z0: number) {
    const parent = new THREE.Group(); parent.userData.geoLayer = 'vegetation'; group.add(parent)
    const placements: ForestPlacement[] = []
    for (let col = 0; col < 16; col++) for (let row = 0; row < 16; row++) {
      const x = x0 + col * 16 + 8 + (hash01(col + x0, row + z0) - 0.5) * 9
      const z = z0 + row * 16 + 8 + (hash01(row + z0, col + x0, 9) - 0.5) * 9
      if (!this.sampleLand(x, z).forest || this.data.landAt(x, z, 'building') || this.data.railProximity(x, z).distance < 12) continue
      const height = this.terrainHeight(x, z)
      if (height === null) continue
      const delta = Math.abs((this.terrainHeight(x + 4, z) ?? height) - (this.terrainHeight(x - 4, z) ?? height))
      if (delta > 10 || hash01(x, z, 4) < 0.12) continue
      placements.push({ x, z, y: height - 0.12, height: 18 + hash01(x, z, 8) * 6, yaw: hash01(x, z, 10) * Math.PI * 2, variant: this.forestVariant(x, z, 11) })
    }
    this.forest.addInstances(parent, placements)
  }
  /** Distant forest silhouettes are prepared for the complete data footprint
   * once. Moving the train never recreates the horizon or reveals a late
   * replacement forest. Match heights to the displayed 64m DEM triangles. */
  private buildDistantForest() {
    const [minX, minZ, maxX, maxZ] = this.data.bundle.dem.bounds
    const regions = new Map<string, ForestPlacement[]>()
    const displayedHeight = (x: number, z: number) => {
      const gx = minX + Math.floor((x - minX) / 64) * 64, gz = minZ + Math.floor((z - minZ) / 64) * 64
      const a = this.terrainHeight(gx, gz), b = this.terrainHeight(gx + 64, gz)
      const c = this.terrainHeight(gx, gz + 64), d = this.terrainHeight(gx + 64, gz + 64)
      if (a === null || b === null || c === null || d === null) return null
      const u = (x - gx) / 64, v = (z - gz) / 64
      return u + v <= 1 ? a * (1 - u - v) + b * u + c * v : d * (u + v - 1) + b * (1 - v) + c * (1 - u)
    }
    for (let x = Math.ceil(minX / 24) * 24; x < maxX; x += 24) for (let z = Math.ceil(minZ / 24) * 24; z < maxZ; z += 24) {
      const px = x + (hash01(x, z, 21) - 0.5) * 18, pz = z + (hash01(x, z, 22) - 0.5) * 18
      if (!this.sampleLand(px, pz).forest || this.data.landAt(px, pz, 'building')) continue
      const y = displayedHeight(px, pz); if (y === null) continue
      const key = `${Math.floor(px / 1024)},${Math.floor(pz / 1024)}`
      const batch = regions.get(key) ?? []
      batch.push({ x: px, z: pz, y, height: 18 + hash01(x, z, 23) * 6, yaw: hash01(x, z, 24) * Math.PI * 2,
        variant: this.forestVariant(px, pz, 25) })
      regions.set(key, batch)
    }
    this.distantForestGroup.name = 'whole-corridor-textured-forest'
    for (const placements of regions.values()) this.distantForest.addInstances(this.distantForestGroup, placements)
    this.group.add(this.distantForestGroup)
  }
  private forestVariant(x: number, z: number, salt: number) {
    const code = this.data.landCover?.sample(x, z)
    const choices = code === 41 ? BROADLEAF_VARIANTS : code === 42 ? EVERGREEN_VARIANTS : MIXED_VARIANTS
    return choices[Math.min(choices.length - 1, Math.floor(hash01(x, z, salt) * choices.length))]
  }
  /** Rasterized OSM polygons mask the terrain surface, so coarse mountain
   * triangles cannot create fictitious islands or erase shoreline holes. */
  private buildLandMask() {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4096
    const ctx = canvas.getContext('2d')!
    const [minX, minZ, maxX, maxZ] = this.data.bundle.dem.bounds
    ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    const cover = this.data.landCover
    if (cover) {
      const source = document.createElement('canvas'); source.width = cover.snapshot.width; source.height = cover.snapshot.height
      const pixels = new Uint8ClampedArray(source.width * source.height * 4)
      for (let i = 0; i < cover.classes.length; i++) {
        pixels[i * 4 + 1] = [41, 42, 43].includes(cover.classes[i]) ? 255 : 0
        pixels[i * 4 + 3] = 255
      }
      source.getContext('2d')!.putImageData(new ImageData(pixels, source.width, source.height), 0, 0)
      ctx.imageSmoothingEnabled = false; ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
    }
    for (const kind of ['farmland', 'forest', 'water'] as const) for (const feature of this.data.features) if (feature.kind === kind) {
      ctx.beginPath()
      for (const ring of [feature.coordinates, ...feature.holes]) {
        ring.forEach((point, i) => {
          const x = (point.x - minX) / (maxX - minX) * canvas.width, y = (maxZ - point.z) / (maxZ - minZ) * canvas.height
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
        }); ctx.closePath()
      }
      ctx.fillStyle = kind === 'water' ? '#ff0000' : kind === 'forest' ? '#00ff00' : '#0000ff'; ctx.fill('evenodd')
    }
    this.landPixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = false
    return texture
  }
  private buildLandSourceMap() {
    const cover = this.data.landCover
    const canvas = document.createElement('canvas'); canvas.width = cover?.snapshot.width ?? 1; canvas.height = cover?.snapshot.height ?? 1
    const pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4)
    for (let i = 0; i < canvas.width * canvas.height; i++) {
      const color = LAND_COVER.get(cover?.classes[i] ?? 250)?.color ?? [0, 0, 0]
      pixels.set([...color, 255], i * 4)
    }
    canvas.getContext('2d')!.putImageData(new ImageData(pixels, canvas.width, canvas.height), 0, 0)
    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = texture.magFilter = THREE.NearestFilter; texture.generateMipmaps = false
    return texture
  }
  private sampleLand(x: number, z: number) {
    const [minX, minZ, maxX, maxZ] = this.data.bundle.dem.bounds
    if (x < minX || x > maxX || z < minZ || z > maxZ) return { forest: false, farm: false }
    const col = Math.min(4095, Math.floor((x - minX) / (maxX - minX) * 4096))
    const row = Math.min(4095, Math.floor((maxZ - z) / (maxZ - minZ) * 4096))
    const index = (row * 4096 + col) * 4
    // Reuse the same rasterized source polygons as the terrain shader. Only
    // strongly covered pixels plant trees, avoiding antialiased water edges.
    const water = this.landPixels[index] > 50
    return { forest: !water && this.landPixels[index + 1] > 200, farm: !water && this.landPixels[index + 2] > 200 }
  }
  private buildWater() {
    for (const feature of this.data.features) if (feature.kind === 'water' && feature.coordinates.length >= 3) {
      const samples = feature.coordinates.map(p => this.data.heightAt(p.x, p.z)).filter((h): h is number => h !== null).sort((a, b) => a - b)
      if (!samples.length) continue
      const largeRiver = feature.tags.name === 'Hudson River' || (feature.bounds[2] - feature.bounds[0]) * (feature.bounds[3] - feature.bounds[1]) > 2e6
      const y = largeRiver ? 0.3 : samples[Math.floor(samples.length * 0.2)] + 0.08
      const geometry = new THREE.ShapeGeometry(shapeOf(feature)); geometry.rotateX(-Math.PI / 2); geometry.translate(0, y, 0)
      const material = new THREE.MeshStandardMaterial({ color: largeRiver ? 0x588895 : 0x638a87, roughness: 0.35, metalness: 0.1, side: THREE.DoubleSide })
      this.waterGroup.add(new THREE.Mesh(geometry, material))
    }
  }
  private buildStations() {
    this.stationGroup.name = 'osm-metro-north-platform-source-geometry'
    this.stationGroup.visible = false
    this.group.add(this.stationGroup)
    for (const station of this.data.stations.filter(item => item.inCurrentRoute)) {
      const stationGround = this.terrainHeight(station.point.x, station.point.z)
      if (stationGround === null) continue
      for (const platform of station.platforms) {
        const ground = platform.coordinates.map(point => this.terrainHeight(point.x, point.z)).filter((value): value is number => value !== null)
        if (!ground.length) continue
        const rise = platformRise(platform.tags, station.platforms.filter(peer => peer !== platform).map(peer => peer.tags))
        const y = this.data.railHeight(station.sMetres) + rise.metres
        if (platform.closed) {
          const shape = shapeOf({ ...platform, kind: 'rail', holes: [] })
          const geometry = new THREE.ShapeGeometry(shape); geometry.rotateX(-Math.PI / 2); geometry.translate(0, y, 0)
          const mesh = new THREE.Mesh(geometry, this.platformMaterial)
          mesh.userData.station = station.name; mesh.userData.sourceId = platform.id; mesh.userData.association = platform.association.method
          mesh.userData.heightSource = rise
          mesh.renderOrder = 15; this.stationGroup.add(mesh)
          const points = platform.coordinates.map(point => new THREE.Vector3(point.x, y + 0.08, point.z))
          const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), this.platformOutlineMaterial)
          outline.userData.station = station.name; outline.userData.sourceId = platform.id; outline.renderOrder = 16
          this.stationGroup.add(outline)
        } else {
          // Open OSM ways remain lines: no closed footprint or width is inferred.
          const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(platform.coordinates.map(point => new THREE.Vector3(point.x, y, point.z))), this.platformOutlineMaterial)
          line.userData.station = station.name; line.userData.sourceId = platform.id; line.userData.geometryType = 'open-source-line'
          line.renderOrder = 16; this.stationGroup.add(line)
        }
      }
      const marker = new THREE.Mesh(new THREE.CircleGeometry(3, 16), this.platformOutlineMaterial)
      marker.rotation.x = -Math.PI / 2; marker.position.set(station.point.x, stationGround + 2, station.point.z)
      marker.userData.station = station.name; marker.userData.operator = 'Metro-North Railroad'; marker.userData.empireServiceStopsHere = station.empireServiceStopsHere
      this.stationGroup.add(marker)
    }
  }
  private disposeChunk(chunk: RealChunk) {
    chunk.group.traverse(object => {
      if (object instanceof THREE.InstancedMesh) object.dispose()
      if (object instanceof THREE.Line) object.geometry.dispose()
      if (object instanceof THREE.Mesh && !object.userData.sharedTerrainResource && !object.userData.sharedGeometry) object.geometry.dispose()
    })
    chunk.group.removeFromParent()
  }
  private clearChunks() { for (const chunk of this.chunks.values()) this.disposeChunk(chunk); this.chunks.clear() }
  dispose() {
    this.disposed = true; this.clearChunks(); this.forest.dispose(); this.distantForest.dispose()
    this.distantForestGroup.traverse(object => { if (object instanceof THREE.InstancedMesh) { object.dispose(); object.geometry.dispose() } })
    this.background?.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose() }); this.routeLine.geometry.dispose(); (this.routeLine.material as THREE.Material).dispose()
    this.marker.geometry.dispose(); (this.marker.material as THREE.Material).dispose()
    this.waterGroup.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose() } })
    this.stationGroup.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.Line) o.geometry.dispose() })
    for (const material of [this.outlineMaterial, this.groundMaterial, this.roadMaterial, this.ballastMaterial, this.railMaterial, this.roofMaterial, this.shelterSupportMaterial, this.shelterOutlineMaterial, this.platformMaterial, this.platformOutlineMaterial, this.wallMaterial, this.taggedWallMaterial, this.estimatedWallMaterial, this.floorsOnlyWallMaterial, this.footprintMaterial, this.tieMaterial]) material.dispose()
    this.landMask.dispose(); this.landSourceMap.dispose(); this.engineeringGeometry.dispose(); this.shelterSupportGeometry.dispose(); this.engineeringMaterial.dispose()
    this.tieGeometry.dispose(); this.group.removeFromParent()
  }
}
