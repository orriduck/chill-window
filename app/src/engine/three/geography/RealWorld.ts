import * as THREE from 'three'
import { platformRise, GeoData, type GeoPoint, type MappedFeature } from './GeoData'
import { GeoGameAssets, type GamePlacement } from './GeoGameAssets'
import { GeoDetailCoverage } from './GeoDetailCoverage'
import { createBackgroundTerrainMaterial } from './GeoBackgroundTerrain'
import { hash01 } from '../core/procedural'
import { installGameTerrain, gameTerrainTexturesReady } from './GeoGameTerrain'

const TILE = 256
const DETAIL_RADIUS = 3
const CACHE_LIMIT = 256
const PRELOAD_METRES = 1536
interface RealChunk { group: THREE.Group; ground: THREE.Mesh; x: number; z: number }
interface CachedChunk extends RealChunk { lastUsed: number; gpuReady: boolean; gpuPreparing: boolean }
const shapeOf = (feature: MappedFeature) => {
  const shape = new THREE.Shape(feature.coordinates.map(p => new THREE.Vector2(p.x, -p.z)))
  for (const hole of feature.holes) shape.holes.push(new THREE.Path(hole.map(p => new THREE.Vector2(p.x, -p.z))))
  return shape
}
const overlaps = (f: MappedFeature, x: number, z: number) => f.bounds[0] <= x + TILE && f.bounds[2] >= x && f.bounds[1] <= z + TILE && f.bounds[3] >= z

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
  private landPixels!: Uint8ClampedArray
  private detailCoverage = new GeoDetailCoverage()
  readonly gameAssets = new GeoGameAssets(this.detailCoverage)
  private distantForestGroup = new THREE.Group()
  private distantHouseGroup = new THREE.Group()
  private textureFailures = 0
  presentable = false
  gpuWarmupMs: number | null = null
  private disposed = false
  private frame = 0
  private waterGroup = new THREE.Group()
  private stationGroup = new THREE.Group()
  private groundMaterial: THREE.MeshStandardMaterial
  private backgroundMaterial: THREE.MeshStandardMaterial
  private outlineMaterial = new THREE.LineBasicMaterial({ color: 0xf1e8c2, transparent: true, opacity: 0.7, depthTest: false })
  private roadMaterial = new THREE.MeshStandardMaterial({ color: 0x747570, roughness: 1 })
  private ballastMaterial = new THREE.MeshStandardMaterial({ color: 0x948d7c, roughness: 1 })
  private railMaterial = new THREE.MeshStandardMaterial({ color: 0x9b9f9e, roughness: 0.5, metalness: 0.5 })
  private platformMaterial = new THREE.MeshStandardMaterial({ color: 0x737b77, roughness: 0.88, side: THREE.DoubleSide })
  private platformOutlineMaterial = new THREE.LineBasicMaterial({ color: 0xe6c786, depthTest: false, transparent: true, opacity: 0.9 })
  private tieMaterial = new THREE.MeshStandardMaterial({ color: 0x736353, roughness: 1 })
  private engineeringGeometry = new THREE.BoxGeometry(1, 1, 1)
  private engineeringMaterial = new THREE.MeshStandardMaterial({ color: 0x656963, roughness: 1 })
  private tieGeometry = new THREE.BoxGeometry(2.5, 0.14, 0.22)
  private rails: { a: GeoPoint; b: GeoPoint; s: number; end: number }[] = []
  pending = 0
  get chunkCount() { return this.chunks.size }
  get assetStatus() { return this.textureFailures ? '场景资源失败' : this.assetsReady ? '奇幻地表 / 村屋 / 林木就绪' : '加载奇幻地表 / 村屋 / 林木' }
  private nearestMissingMetres = PRELOAD_METRES
  private lastBuildMs = 0
  private maxBuildMs = 0
  private visibleMissing = 0
  private suddenAppearanceFrames = 0
  private prefetchPending = 0
  private preparationTarget: number | null = null
  private advanceTarget: number | null = null
  private gpuPriority = new Map<string, number>()
  get streamingStats() {
    return { cached: this.chunks.size, visible: [...this.chunks.values()].filter(c => c.group.visible).length,
      pending: this.pending, preloadMetres: PRELOAD_METRES, nearestMissingMetres: this.nearestMissingMetres,
      lastBuildMs: this.lastBuildMs, maxBuildMs: this.maxBuildMs, visibleMissing: this.visibleMissing,
      suddenAppearanceFrames: this.suddenAppearanceFrames, assets: this.assetStatus, ready: this.presentable, gpuWarmupMs: this.gpuWarmupMs, sceneFrame: this.frame, pendingGpu: [...this.chunks.values()].filter(chunk => !chunk.gpuReady).length, prefetchPending: this.prefetchPending }
  }
  get visibleTiles() { return [...this.chunks.values()].map(c => ({ x: c.x, z: c.z, mesh: c.ground })) }

  get terrainCoverageStats() {
    let readyTiles = 0
    for (let i = 0; i < this.detailCoverage.pixels.length; i += 4) if (this.detailCoverage.pixels[i] === 255) readyTiles++
    return { readyTiles, minTile: this.detailCoverage.minTile.toArray(), backgroundVisible: this.background?.visible ?? false }
  }
  /** Read the actual uploaded current-view chunks without waiting for a later
   * RAF to refresh the display mask or scheduling any forward preparation. */
  gpuCoverageAt(s: number) {
    const pose = this.data.pose(s), keys = [...this.tilesAt(pose.x, pose.z).keys()]
    return { readyTiles: keys.filter(key => this.chunks.get(key)?.gpuReady === true).length, totalTiles: keys.length,
      pendingGpu: [...this.chunks.values()].filter(chunk => !chunk.gpuReady).length }
  }

  readonly data: GeoData
  constructor(data: GeoData, initialS = data.checkpoints[0]?.s ?? 0) {
    this.data = data
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject })
    this.landMask = this.buildLandMask()
    this.group.name = 'hudson-fantasy-world'
    this.group.visible = false
    this.groundMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.97 })
    installGameTerrain(this.groundMaterial, this.landMask, data.bundle.dem.bounds)
    this.backgroundMaterial = createBackgroundTerrainMaterial(this.groundMaterial, this.detailCoverage)
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
      const mesh = new THREE.Mesh(this.terrainGeometry(x, z, Math.min(1024, maxX - x), Math.min(1024, maxZ - z), 64), this.backgroundMaterial)
      mesh.receiveShadow = true; this.background.add(mesh)
    }
    this.group.add(this.background)
    this.buildWater()
    this.buildStations()
    this.initialKeys = this.initialPreloadKeys(initialS)
    // No chunks are built until the actual shared models and painted maps
    // have decoded. They then participate in the existing GPU fence gate.
    void Promise.all([gameTerrainTexturesReady, this.gameAssets.ready]).then(() => {
      if (this.disposed) return
      this.buildDistantForest()
      this.buildDistantHouses()
      this.assetsReady = true
    }).catch(error => { if (!this.disposed) { this.textureFailures++; this.rejectReady(error) } })
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
  private tilesBetween(fromS: number, toS: number) {
    const low = Math.min(fromS, toS), high = Math.max(fromS, toS)
    const points = [this.data.pose(low), this.data.pose(high)]
    // Endpoint coverage can miss a corner tile crossed inside a curved route
    // segment. The bounding rectangle of every source vertex in this step
    // contains the complete piecewise-linear path, including extrema.
    for (let i = 0; i < this.data.points.length; i++) if (this.data.distances[i] > low && this.data.distances[i] < high) points.push(this.data.pose(this.data.distances[i]))
    const minX = Math.floor(Math.min(...points.map(p => p.x)) / TILE) - DETAIL_RADIUS
    const maxX = Math.floor(Math.max(...points.map(p => p.x)) / TILE) + DETAIL_RADIUS
    const minZ = Math.floor(Math.min(...points.map(p => p.z)) / TILE) - DETAIL_RADIUS
    const maxZ = Math.floor(Math.max(...points.map(p => p.z)) / TILE) + DETAIL_RADIUS
    const tiles = new Map<string, { x: number; z: number }>()
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) tiles.set(`${x},${z}`, { x, z })
    return tiles
  }
  canAdvance(s: number, fromS = s) {
    if (!this.presentable) return false
    return [...this.tilesBetween(fromS, s).keys()].every(key => this.chunks.get(key)?.gpuReady === true)
  }
  captureGpuChunks() { return [...this.chunks.values()].map(chunk => chunk.group) }
  markGpuChunks(groups: THREE.Group[]) {
    const prepared = new Set(groups)
    for (const group of groups) group.traverse(object => {
      if (object instanceof THREE.InstancedMesh && object.userData.preparedInstanceBufferVersion !== object.instanceMatrix.version) throw new Error('区块实例缓冲尚未通过 GPU 上传与同步检查')
    })
    for (const chunk of this.chunks.values()) if (prepared.has(chunk.group)) { chunk.gpuReady = true; chunk.gpuPreparing = false }
  }
  takeGpuChunks() {
    const pending = [...this.chunks.entries()].filter(([, chunk]) => !chunk.gpuReady && !chunk.gpuPreparing)
      .sort(([a], [b]) => (this.gpuPriority.get(a) ?? Infinity) - (this.gpuPriority.get(b) ?? Infinity))
      .slice(0, 12)
    for (const [, chunk] of pending) chunk.gpuPreparing = true
    return pending.map(([, chunk]) => chunk.group)
  }
  prepareAt(s: number | null) { this.preparationTarget = s }
  prepareAdvance(s: number | null) { this.advanceTarget = s }
  /** Rail-bed correction is a narrow engineering visualization, not a new
   * geographical landform. Bridges/tunnels keep their ground DEM below/above. */
  terrainHeight(x: number, z: number) { return this.currentTerrainHeight(x, z) }
  /** Sample the actual displayed triangle, including the 0.18m ground offset. */
  private groundAt(x: number, z: number, step = 8) {
    const [minX, minZ] = this.data.bundle.dem.bounds
    const originX = step === 64 ? minX : 0, originZ = step === 64 ? minZ : 0
    const gx = originX + Math.floor((x - originX) / step) * step, gz = originZ + Math.floor((z - originZ) / step) * step
    const a = this.terrainHeight(gx, gz), b = this.terrainHeight(gx + step, gz), c = this.terrainHeight(gx, gz + step), d = this.terrainHeight(gx + step, gz + step)
    if (a === null || b === null || c === null || d === null) return null
    const u = (x - gx) / step, v = (z - gz) / step
    return (u + v <= 1 ? a * (1 - u - v) + b * u + c * v : d * (u + v - 1) + b * (1 - v) + c * (1 - u)) + (step === 8 ? 0.18 : 0)
  }
  private currentTerrainHeight(x: number, z: number) {
    const raw = this.data.heightAt(x, z)
    if (raw === null) return null
    const near = this.data.railProximity(x, z)
    if (near.distance < 18 && !this.data.engineeringAt(x, z)) {
      const t = THREE.MathUtils.smoothstep(near.distance, 4, 18)
      return THREE.MathUtils.lerp(this.data.railHeight(near.s) - 0.25, raw, t)
    }
    return raw
  }
  update(s: number, inspection: boolean, focus: THREE.Vector3, layers: { ground: boolean; vegetation: boolean; groundcover: boolean; settlements: boolean; buildings: boolean; water: boolean; stations: boolean }, mapCameraPosition: THREE.Vector3) {
    const pose = this.data.pose(s)
    // Inspection may begin before source PNGs decode. Keep all terrain out
    // of shader compilation until its actual shared resources are available.
    this.group.visible = this.assetsReady && (this.presentable || inspection)
    if (inspection) { this.group.position.set(0, 0, 0); this.group.rotation.y = 0 }
    else {
      this.group.rotation.y = -pose.heading
      this.group.position.set(-pose.dz * pose.x + pose.dx * pose.z, 0, s - pose.dx * pose.x - pose.dz * pose.z)
    }
    this.routeLine.visible = this.marker.visible = inspection
    this.marker.position.set(pose.x, this.data.railHeight(s) + 22, pose.z)
    this.waterGroup.visible = layers.water; this.stationGroup.visible = layers.stations
    const point = inspection ? focus : pose
    const houseCamera = inspection ? mapCameraPosition : new THREE.Vector3(pose.x, this.data.railHeight(s) + 2, pose.z)
    this.detailCoverage.update(point.x, point.z, key => this.chunks.get(key)?.gpuReady === true)
    this.gameAssets.focus.value.set(point.x, point.z)
    this.distantHouseGroup.visible = layers.buildings
    for (const region of this.distantHouseGroup.children) { const center = region.userData.center as THREE.Vector2; region.visible = center.distanceTo(new THREE.Vector2(point.x, point.z)) < 3300 }
    this.distantForestGroup.visible = layers.vegetation
    for (const child of this.distantForestGroup.children) if (child instanceof THREE.InstancedMesh && child.boundingSphere) {
      const sphere = child.boundingSphere
      child.visible = Math.hypot(sphere.center.x - point.x, sphere.center.z - point.z) - sphere.radius < 2600
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
    const urgent = new Set(this.tilesAt(pose.x, pose.z).keys())
    if (preparing) for (const [key, tile] of this.tilesAt(preparing.x, preparing.z)) required.set(key, tile)
    if (preparing) for (const key of this.tilesAt(preparing.x, preparing.z).keys()) urgent.add(key)
    if (this.advanceTarget !== null) {
      // A bend between the 256m route samples may enter a corner tile that
      // none of those samples cover. Always queue the exact motion target,
      // or the coverage guard could hold the train without building it.
      for (const [key, tile] of this.tilesBetween(s, this.advanceTarget)) { required.set(key, tile); urgent.add(key) }
    }
    this.gpuPriority.clear()
    for (const [key, tile] of required) {
      const rank = wanted.has(key) ? 0 : urgent.has(key) ? 1 : 2
      this.gpuPriority.set(key, rank * 1e12 + ((tile.x + 0.5) * TILE - point.x) ** 2 + ((tile.z + 0.5) * TILE - point.z) ** 2)
    }
    const missing = [...required.entries()].filter(([key]) => !this.chunks.has(key))
      .map(([key, tile]) => {
        const centerX = (tile.x + 0.5) * TILE, centerZ = (tile.z + 0.5) * TILE
        const route = inspection ? this.data.nearestRoute(centerX, centerZ) : null
        const distance = preparing ? Math.hypot(centerX - preparing.x, centerZ - preparing.z) : route && route.distance < 420
          ? Math.abs(route.s - currentS) * 0.3 + route.distance
          : Math.hypot(centerX - point.x, centerZ - point.z)
        return { key, tile, distance, priority: wanted.has(key) ? 0 : urgent.has(key) ? 1 : 2 }
      }).sort((a, b) => a.priority - b.priority || a.distance - b.distance)
    this.pending = [...wanted.keys()].filter(key => !this.chunks.get(key)?.gpuReady).length
    this.visibleMissing = this.presentable ? this.pending : 0
    if (this.presentable && !inspection && this.visibleMissing) this.suddenAppearanceFrames++
    this.prefetchPending = missing.length
    this.nearestMissingMetres = missing.length ? Math.round(missing[0].distance) : PRELOAD_METRES
    // Tile creation is time-sliced across animation frames; the current view
    // has priority, followed by the route-aligned safety buffer.
    const buildStarted = performance.now()
    while (this.assetsReady && missing.length && performance.now() - buildStarted < 8) {
      const { key, tile } = missing.shift()!, started = performance.now()
      const created = this.createChunk(tile.x, tile.z)
      this.lastBuildMs = performance.now() - started
      this.maxBuildMs = Math.max(this.maxBuildMs, this.lastBuildMs)
      created.group.visible = false
      this.chunks.set(key, { ...created, lastUsed: this.frame, gpuReady: false, gpuPreparing: false })
    }
    for (const chunk of this.chunks.values()) {
      const key = `${chunk.x},${chunk.z}`
      chunk.group.visible = wanted.has(key) && (chunk.gpuReady || !this.presentable)
      if (chunk.group.visible) chunk.lastUsed = this.frame
      chunk.ground.visible = layers.ground
      this.gameAssets.setHouseDetail(chunk.group, houseCamera)
      for (const child of chunk.group.children) {
        const layer = child.userData.geoLayer
        if (layer === 'vegetation') child.visible = layers.vegetation
        if (layer === 'groundcover') child.visible = layers.groundcover
        if (layer === 'building') child.visible = layers.buildings ?? true
        if (layer === 'settlement') {
          child.visible = layers.settlements
        }
        if (layer === 'inspection') child.visible = inspection
      }
    }
    if (!this.readyResolved && [...this.initialKeys].every(key => this.chunks.has(key))) {
      this.readyResolved = true
      this.resolveReady()
    }
    const cachedOutsideView = [...this.chunks.entries()].filter(([key, chunk]) => !required.has(key) && !chunk.gpuPreparing).sort((a, b) => a[1].lastUsed - b[1].lastUsed)
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
      const sample = step === 64 ? (x: number, z: number) => this.currentTerrainHeight(x, z) : (x: number, z: number) => this.terrainHeight(x, z)
      const h = sample(x, z)
      valid.push(h !== null); positions.push(x, h ?? 0, z); uv.push(x * 0.08, z * 0.08)
      const hx0 = sample(x - 4, z) ?? h ?? 0, hx1 = sample(x + 4, z) ?? h ?? 0
      const hz0 = sample(x, z - 4) ?? h ?? 0, hz1 = sample(x, z + 4) ?? h ?? 0
      const normal = new THREE.Vector3(hx0 - hx1, 8, hz0 - hz1).normalize(); normals.push(normal.x, normal.y, normal.z)
      colors.push(1, 1, 1)
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
    if (step === 2) geometry.computeVertexNormals()
    return geometry
  }
  private createChunk(cx: number, cz: number): RealChunk {
    const group = new THREE.Group(), x0 = cx * TILE, z0 = cz * TILE
    const step = 8
    const ground = new THREE.Mesh(this.terrainGeometry(x0, z0, TILE, TILE, step), this.groundMaterial)
    ground.userData.terrainStep = step
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
    this.gameAssets.addHouses(group, buildings.filter(f => !this.data.landAt((f.bounds[0] + f.bounds[2]) / 2, (f.bounds[1] + f.bounds[3]) / 2, 'water')), (x, z) => this.groundAt(x, z))
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
  private plantable(x: number, z: number) {
    if (this.data.landAt(x, z, 'water') || this.data.landAt(x, z, 'building') || this.data.railProximity(x, z).distance <= 10) return false
    // Roads are open source polylines; polygon containment cannot exclude them.
    for (const road of this.data.nearbyFeatures(x, z)) if (road.kind === 'road') for (let i = 1; i < road.coordinates.length; i++) {
      const a = road.coordinates[i - 1], b = road.coordinates[i], dx = b.x - a.x, dz = b.z - a.z
      const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / Math.max(dx * dx + dz * dz, 0.001), 0, 1)
      const clearance = /motorway|trunk/.test(road.tags.highway ?? '') ? 7 : 4
      if (Math.hypot(x - a.x - t * dx, z - a.z - t * dz) < clearance) return false
    }
    return true
  }
  private treePlacements(x0: number, z0: number, width: number, step: number, groundStep: number) {
    const placements: GamePlacement[] = []
    for (let x = x0 + step / 2; x < x0 + width; x += step) for (let z = z0 + step / 2; z < z0 + width; z += step) {
      const px = x + (hash01(x, z, 2) - 0.5) * step * 0.7, pz = z + (hash01(x, z, 3) - 0.5) * step * 0.7
      if (!this.sampleLand(px, pz).forest || !this.plantable(px, pz) || hash01(px, pz, 4) < 0.1) continue
      const y = this.groundAt(px, pz, groundStep); if (y === null) continue
      placements.push({ x: px, y, z: pz, height: 12 + hash01(px, pz, 8) * 6, yaw: hash01(px, pz, 10) * Math.PI * 2, variant: Math.floor(hash01(px, pz, 9) * 3) })
    }
    return placements
  }
  private addVegetation(group: THREE.Group, x0: number, z0: number) {
    const trees = new THREE.Group(); trees.userData.geoLayer = 'vegetation'; group.add(trees)
    const placements = this.treePlacements(x0, z0, TILE, 14, 8)
    for (const [i, name] of ['tree_oak', 'tree_detailed', 'tree_default'].entries()) this.gameAssets.addBatch(trees, name, placements.filter(p => p.variant === i))
    const cover = new THREE.Group(); cover.userData.geoLayer = 'groundcover'; group.add(cover)
    const batches = new Map<string, GamePlacement[]>()
    // A bounded 256m tile lattice supplies low plants. Tile visibility bounds
    // this detail to the loaded neighborhood; no per-frame instances rebuild.
    for (let x = x0 + 3; x < x0 + TILE; x += 8) for (let z = z0 + 3; z < z0 + TILE; z += 8) {
      const px = x + (hash01(x, z, 61) - 0.5) * 5, pz = z + (hash01(x, z, 62) - 0.5) * 5
      if (!this.plantable(px, pz)) continue
      const y = this.groundAt(px, pz); if (y === null) continue
      const r = hash01(px, pz, 63), forest = this.sampleLand(px, pz).forest
      if (r < 0.25) continue
      const name = r > 0.985 ? 'rock_largeA' : r > 0.95 ? 'rock_smallA' : forest && r > 0.65 ? 'plant_bushDetailed' : r > 0.85 ? 'plant_bushSmall' : 'grass_leafs'
      const batch = batches.get(name) ?? []
      batch.push({ x: px, y: y - 0.02, z: pz, height: name.startsWith('rock') ? 0.5 + r : name.startsWith('plant') ? 0.7 + r * 0.7 : 0.3 + r * 0.4, yaw: r * Math.PI * 2, variant: 0 }); batches.set(name, batch)
    }
    for (const [name, batch] of batches) this.gameAssets.addBatch(cover, name, batch)
  }
  private buildDistantForest() {
    const [minX, minZ, maxX, maxZ] = this.data.bundle.dem.bounds
    this.distantForestGroup.name = 'hudson-fantasy-distant-canopies'
    for (let x = minX; x < maxX; x += 1024) for (let z = minZ; z < maxZ; z += 1024) {
      const placements = this.treePlacements(x, z, 1024, 40, 64)
      this.gameAssets.addBatch(this.distantForestGroup, 'tree_oak', placements, true)
    }
    this.group.add(this.distantForestGroup)
  }
  private buildDistantHouses() {
    const regions = new Map<string, MappedFeature[]>()
    for (const feature of this.data.features) if (feature.kind === 'building') {
      const x = (feature.bounds[0] + feature.bounds[2]) / 2, z = (feature.bounds[1] + feature.bounds[3]) / 2
      if (this.data.landAt(x, z, 'water')) continue
      const key = `${Math.floor(x / 1024)},${Math.floor(z / 1024)}`, features = regions.get(key) ?? []
      features.push(feature); regions.set(key, features)
    }
    this.distantHouseGroup.name = 'whole-corridor-fantasy-villages'
    for (const [key, features] of regions) {
      const [x, z] = key.split(',').map(Number), region = new THREE.Group()
      region.userData.center = new THREE.Vector2(x * 1024 + 512, z * 1024 + 512)
      this.gameAssets.addHouses(region, features, (x, z) => this.groundAt(x, z, 64), true)
      this.distantHouseGroup.add(region)
    }
    this.group.add(this.distantHouseGroup)
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
      const material = new THREE.MeshStandardMaterial({ color: largeRiver ? 0x377d89 : 0x4b8c82, roughness: 0.28, metalness: 0.18, side: THREE.DoubleSide })
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
    this.gameAssets.release(chunk.group)
    chunk.group.traverse(object => {
      if (object instanceof THREE.InstancedMesh) object.dispose()
      if (object instanceof THREE.Line) object.geometry.dispose()
      if (object instanceof THREE.Mesh && !object.userData.sharedTerrainResource && !object.userData.sharedGeometry) object.geometry.dispose()
    })
    chunk.group.removeFromParent()
  }
  private clearChunks() { for (const chunk of this.chunks.values()) this.disposeChunk(chunk); this.chunks.clear() }
  dispose() {
    this.disposed = true; this.clearChunks(); this.gameAssets.dispose(); this.detailCoverage.dispose()
    for (const group of [this.distantForestGroup, this.distantHouseGroup]) group.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose() })
    this.background?.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose() }); this.routeLine.geometry.dispose(); (this.routeLine.material as THREE.Material).dispose()
    this.marker.geometry.dispose(); (this.marker.material as THREE.Material).dispose()
    this.waterGroup.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose() } })
    this.stationGroup.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.Line) o.geometry.dispose() })
    for (const material of [this.outlineMaterial, this.groundMaterial, this.backgroundMaterial, this.roadMaterial, this.ballastMaterial, this.railMaterial, this.platformMaterial, this.platformOutlineMaterial, this.tieMaterial]) material.dispose()
    this.landMask.dispose(); this.engineeringGeometry.dispose(); this.engineeringMaterial.dispose()
    this.tieGeometry.dispose(); this.group.removeFromParent()
  }
}
