import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { buildingHeight, buildingStructureKind, segmentDistance, type GeoData, type MappedFeature } from './GeoData'
import { applyBuildingAppearance, buildingAppearance } from './GeoBuilding'
import { convertedOrigin } from './GeoConvertedBuildingRecords'
import { corridorBuildingIds, corridorBuildingTotal } from './GeoCorridorBuildingRecords'
import { GeoCorridorBuildingAssets, type CorridorBuildingRecord, type CorridorBuildingTile } from './GeoCorridorBuildingAssets'
import type { GeoAerial } from './GeoAerial'

/** Match OSM2World's local metric Mercator coordinates to the ride's Mercator
 * coordinates. The exported GLB has south-positive Z; the ride is north-positive.
 * OSM2World snaps horizontal coordinates to millimetres. */
export function convertedProjection(data: Pick<GeoData, 'project' | 'bundle'>, originLonLat: readonly [number, number] = convertedOrigin) {
  const origin = data.project([...originLonLat])
  const scale = Math.cos(data.bundle.origin[1] * Math.PI / 180) / Math.cos(originLonLat[1] * Math.PI / 180)
  return { origin, scale }
}

interface GeometryBucket { material: THREE.MeshStandardMaterial; geometries: THREE.BufferGeometry[] }

export class GeoConvertedBuildings {
  readonly group = new THREE.Group()
  readonly originals = new THREE.Group()
  readonly converted = new THREE.Group()
  // RealWorld constructs distant meshes immediately. Replacement IDs must
  // exist synchronously, before an asynchronous catalogue request can finish.
  readonly replacedIds = new Set<string>(corridorBuildingIds)
  readonly ready: Promise<void>
  readonly focusPoint = new THREE.Vector3()
  readonly stats = { ready: false, total: corridorBuildingTotal, buildings: 0, rejectedDefaults: 957, triangles: 0, meshes: 0,
    tiles: 0, totalTiles: 415, sourceTags: 0, sourceEstimates: 0, openRoofs: 0, textures: 0, imageSources: 0, modelBytes: 0, textureBytes: 0,
    maxAlignmentErrorMetres: 0, maxWindowOffsetMetres: 0, prepareMs: 0, batchMs: 0 }
  private geometries = new Set<THREE.BufferGeometry>()
  private materials = new Set<THREE.Material>()
  private disposed = false
  private assets = new GeoCorridorBuildingAssets()
  get transportStats() { return this.assets.stats }
  private data: GeoData
  private groundAt: (x: number, z: number) => number | null
  private aerial: GeoAerial
  private materialCache = new Map<string, THREE.MeshStandardMaterial>()
  private convertedBuckets = new Map<string, GeometryBucket>()
  private originalBuckets = new Map<string, THREE.BufferGeometry[]>()

  constructor(data: GeoData, groundAt: (x: number, z: number) => number | null, aerial: GeoAerial) {
    this.data = data; this.groundAt = groundAt; this.aerial = aerial
    this.group.name = 'hudson-source-backed-converted-buildings'
    this.group.add(this.originals, this.converted); this.group.visible = false
    this.ready = this.prepare().catch(error => { this.disposed = true; this.release(); throw error })
  }

  private async prepare() {
    const started = performance.now()
    const catalog = await this.assets.prepare()
    this.stats.textures = this.assets.stats.textures; this.stats.textureBytes = this.assets.stats.textureBytes
    const features = new Map(this.data.features.filter(feature => feature.kind === 'building').map(feature => [String(feature.id), feature]))
    let next = 0
    const worker = async () => {
      while (next < catalog.tiles.length && !this.disposed) {
        const tile = catalog.tiles[next++]
        const gltf = await this.assets.loadTile(tile)
        gltf.scene.updateMatrixWorld(true)
        const nodes = new Map<string, THREE.Object3D>()
        gltf.scene.traverse(object => {
          if (typeof object.userData.osmId === 'string') {
            if (nodes.has(object.userData.osmId)) throw new Error(`重复建筑绑定 ${object.userData.osmId}`)
            nodes.set(object.userData.osmId, object)
          }
          if (object instanceof THREE.Mesh) {
            this.geometries.add(object.geometry)
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
              this.materials.add(material)
              for (const value of Object.values(material)) if (value instanceof THREE.Texture) this.assets.textures.add(value)
            }
          }
        })
        if (this.disposed) { this.release(); return }
        if (nodes.size !== tile.records.length) throw new Error(`建筑模型绑定数量不匹配 ${tile.uri}`)
        for (const record of tile.records) {
          const feature = features.get(record.sourceId), node = nodes.get(record.transportId)
          if (!feature || !node) throw new Error(`建筑来源缺失 ${record.sourceId}`)
          this.prepareBuilding(tile, record, feature, node)
        }
        // The imported geometry has been baked; only static region batches
        // survive departure. Keep image Sources shared across all parsers.
        gltf.scene.traverse(object => {
          if (object instanceof THREE.Mesh) { object.geometry.dispose(); this.geometries.delete(object.geometry) }
        })
        this.stats.tiles++; this.stats.modelBytes = this.assets.stats.modelBytes
        await new Promise<void>(resolve => setTimeout(resolve, 0))
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker))
    if (this.disposed) { this.release(); return }
    this.stats.imageSources = new Set([...this.assets.textures].map(texture => texture.source)).size
    if (this.stats.imageSources !== catalog.textures.length) throw new Error('建筑解析未共享同一图片Source')
    if (this.stats.buildings !== catalog.totalBuildings || this.stats.modelBytes !== catalog.modelBytes
      || this.stats.sourceTags !== catalog.sourceTags || this.stats.sourceEstimates !== catalog.sourceEstimates || this.stats.openRoofs !== catalog.openRoofs) throw new Error('完整建筑准备数量或来源统计不匹配')
    const batchStarted = performance.now()
    for (const [region, bucket] of this.convertedBuckets) {
      this.aerial.install(bucket.material, true)
      this.addBatch(bucket.geometries, bucket.material, this.converted, region)
      this.stats.meshes++
    }
    this.convertedBuckets.clear()
    const originalMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1 })
    this.materials.add(originalMaterial); this.aerial.install(originalMaterial, true)
    for (const [region, geometries] of this.originalBuckets) this.addBatch(geometries, originalMaterial, this.originals, region)
    this.originalBuckets.clear()
    this.stats.batchMs = performance.now() - batchStarted
    this.stats.ready = true; this.stats.prepareMs = performance.now() - started
  }

  private prepareBuilding(tile: CorridorBuildingTile, record: CorridorBuildingRecord, feature: MappedFeature, node: THREE.Object3D) {
    const height = buildingHeight(feature)
    if (buildingStructureKind(feature) !== 'building' || (feature.tags.building === 'roof') !== record.openRoof
      || height.status !== record.heightStatus.replaceAll('_', '-') || Math.abs((height.metres ?? -1) - record.heightMetres) > 0.000001) throw new Error(`转换建筑源高度/结构不匹配 ${record.sourceId}`)
    const x = (feature.bounds[0] + feature.bounds[2]) / 2, z = (feature.bounds[1] + feature.bounds[3]) / 2
    const ground = this.groundAt(x, z)
    if (ground === null) throw new Error(`转换建筑没有可用地面 ${record.sourceId}`)
    // Source buildings can overlap a coarser water polygon. Do not discard
    // an independently validated footprint because that mask overlaps it.
    if (!this.stats.buildings || record.sourceId === 'osm/way/280176097') this.focusPoint.set(x, ground + record.heightMetres / 2, z)
    const projection = convertedProjection(this.data, tile.origin)
    const transform = new THREE.Matrix4().makeScale(projection.scale, 1, -projection.scale).setPosition(projection.origin.x, ground, projection.origin.z)
    const appearance = buildingAppearance(feature), region = `${Math.floor(x / 1024)},${Math.floor(z / 1024)}`
    let maxHeight = -Infinity, minHeight = Infinity
    const meshes: { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial; sourceName: string }[] = []
    node.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      if (!(object.material instanceof THREE.MeshStandardMaterial)) throw new Error('转换建筑需要单个PBR材质 primitive')
      const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld).applyMatrix4(transform)
      this.geometries.add(geometry)
      if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i))
      const index = geometry.index!
      for (let i = 0; i < index.count; i += 3) { const b = index.getX(i + 1); index.setX(i + 1, index.getX(i + 2)); index.setX(i + 2, b) }
      index.needsUpdate = true
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
      const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal')
      if (!geometry.getAttribute('uv')) geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(positions.count * 2), 2))
      const roof = new THREE.Color(appearance.roofColor), wall = new THREE.Color(appearance.facadeColor), colors = new Float32Array(positions.count * 3)
      for (let i = 0; i < positions.count; i++) {
        const y = positions.getY(i) - ground
        minHeight = Math.min(minHeight, y); maxHeight = Math.max(maxHeight, y)
        const color = record.openRoof || normals.getY(i) > 0.55 ? roof : wall
        colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      meshes.push({ geometry, material: this.sharedMaterial(object.material), sourceName: object.material.name })
      this.stats.triangles += index.count / 3
    })
    if (Math.abs(maxHeight - record.heightMetres) > 0.001 || (record.openRoof ? minHeight <= 0.01 : Math.abs(minHeight) > 0.001)) throw new Error(`转换建筑高度/开放屋顶校验失败 ${record.sourceId}: ${minHeight}/${maxHeight}`)
    const rings = [feature.coordinates, ...feature.holes]
    for (const mesh of meshes) {
      const positions = mesh.geometry.getAttribute('position')
      for (let i = 0; i < positions.count; i++) {
        const y = positions.getY(i) - ground
        if (Math.abs(y - (record.openRoof ? minHeight : 0)) > 0.001) continue
        const error = Math.min(...rings.map(ring => Math.min(...ring.map((a, j) => segmentDistance(positions.getX(i), positions.getZ(i), a, ring[(j + 1) % ring.length]).distance))))
        if (mesh.sourceName === 'Windows') { this.stats.maxWindowOffsetMetres = Math.max(this.stats.maxWindowOffsetMetres, error); continue }
        if (error > 0.01) throw new Error(`转换建筑足迹校验失败 ${record.sourceId}: ${error}m`)
        this.stats.maxAlignmentErrorMetres = Math.max(this.stats.maxAlignmentErrorMetres, error)
      }
      const key = `${region}:${mesh.material.uuid}`, bucket = this.convertedBuckets.get(key) ?? { material: mesh.material, geometries: [] }
      bucket.geometries.push(mesh.geometry); this.convertedBuckets.set(key, bucket)
    }
    const shape = new THREE.Shape(feature.coordinates.map(point => new THREE.Vector2(point.x, -point.z)))
    for (const hole of feature.holes) shape.holes.push(new THREE.Path(hole.map(point => new THREE.Vector2(point.x, -point.z))))
    const sourceOriginal = record.openRoof ? new THREE.ShapeGeometry(shape) : new THREE.ExtrudeGeometry(shape, { depth: record.heightMetres, bevelEnabled: false, steps: 1 })
    // ShapeGeometry has indices; ExtrudeGeometry does not. Use one layout so
    // roof-only comparisons and solid originals can share a region batch.
    const original = sourceOriginal.index ? sourceOriginal.toNonIndexed() : sourceOriginal
    if (sourceOriginal !== original) sourceOriginal.dispose()
    if (record.openRoof) {
      const color = new THREE.Color(appearance.roofColor), colors = new Float32Array(original.getAttribute('position').count * 3)
      for (let i = 0; i < colors.length; i += 3) { colors[i] = color.r; colors[i + 1] = color.g; colors[i + 2] = color.b }
      original.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    } else applyBuildingAppearance(original, appearance)
    original.rotateX(-Math.PI / 2); original.translate(0, ground + (record.openRoof ? record.heightMetres : -0.1), 0)
    this.geometries.add(original)
    const originals = this.originalBuckets.get(region) ?? []; originals.push(original); this.originalBuckets.set(region, originals)
    this.stats.buildings++
    if (record.heightStatus === 'source_tag') this.stats.sourceTags++; else this.stats.sourceEstimates++
    if (record.openRoof) this.stats.openRoofs++
  }

  private sharedMaterial(material: THREE.MeshStandardMaterial) {
    const textureKey = (texture: THREE.Texture | null) => texture ? [texture.source.uuid, texture.colorSpace, texture.channel, texture.flipY,
      texture.wrapS, texture.wrapT, texture.minFilter, texture.magFilter, ...texture.offset.toArray(), ...texture.repeat.toArray(), ...texture.center.toArray(), texture.rotation].join(',') : ''
    const key = JSON.stringify([material.name, material.opacity, material.transparent, material.alphaTest, material.side, material.metalness,
      textureKey(material.map), textureKey(material.normalMap), textureKey(material.roughnessMap), textureKey(material.metalnessMap), textureKey(material.aoMap), textureKey(material.emissiveMap)])
    const existing = this.materialCache.get(key)
    if (existing) return existing
    material.color.set(0xffffff); material.vertexColors = true; material.roughness = 0.95; material.normalScale.setScalar(0.3)
    material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
#ifdef USE_MAP
vec4 geoSurfaceSample = texture2D(map, vMapUv);
float geoSurfaceLuma = dot(geoSurfaceSample.rgb, vec3(0.2126, 0.7152, 0.0722));
diffuseColor.rgb *= mix(0.82, 1.08, sqrt(clamp(geoSurfaceLuma, 0.0, 1.0)));
diffuseColor.a *= geoSurfaceSample.a;
#endif`)
    }
    material.customProgramCacheKey = () => 'converted-building-source-palette-surface-v2'
    material.needsUpdate = true; this.materialCache.set(key, material)
    return material
  }

  private addBatch(geometries: THREE.BufferGeometry[], material: THREE.MeshStandardMaterial, target: THREE.Group, name: string) {
    const merged = mergeGeometries(geometries, false)
    if (!merged) throw new Error(`转换建筑合批失败 ${name}`)
    this.geometries.add(merged); merged.computeBoundingSphere()
    const mesh = new THREE.Mesh(merged, material)
    mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true; target.add(mesh)
    for (const geometry of geometries) { geometry.dispose(); this.geometries.delete(geometry) }
  }

  setVisible(visible: boolean, converted: boolean) {
    this.group.visible = visible && this.stats.ready
    this.converted.visible = converted; this.originals.visible = !converted
  }
  private release() {
    this.geometries.forEach(geometry => geometry.dispose()); this.geometries.clear()
    this.materials.forEach(material => material.dispose()); this.materials.clear(); this.materialCache.clear()
    this.assets.dispose(); this.convertedBuckets.clear(); this.originalBuckets.clear()
  }
  dispose() { this.disposed = true; this.release(); this.group.removeFromParent() }
}
