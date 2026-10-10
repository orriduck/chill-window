import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { buildingHeight, buildingStructureKind, type GeoData } from './GeoData'
import { applyBuildingAppearance, buildingAppearance } from './GeoBuilding'
import { convertedBuildingRecords, convertedBuildingSha256, convertedOrigin } from './GeoConvertedBuildingRecords'

/** Match OSM2World's local metric Mercator coordinates to the ride's Mercator
 * coordinates. The exported GLB has south-positive Z; the ride is north-positive.
 * OSM2World snaps horizontal coordinates to millimetres. */
export function convertedProjection(data: Pick<GeoData, 'project' | 'bundle'>) {
  const origin = data.project([...convertedOrigin])
  const scale = Math.cos(data.bundle.origin[1] * Math.PI / 180) / Math.cos(convertedOrigin[1] * Math.PI / 180)
  return { origin, scale }
}

export class GeoConvertedBuildings {
  readonly group = new THREE.Group()
  readonly originals = new THREE.Group()
  readonly converted = new THREE.Group()
  readonly replacedIds = new Set(convertedBuildingRecords.map(record => record.featureId as string))
  readonly ready: Promise<void>
  readonly focusPoint = new THREE.Vector3()
  readonly stats = { ready: false, buildings: 0, rejectedDefaults: 3, triangles: 0, meshes: 0, maxAlignmentErrorMetres: 0, prepareMs: 0 }
  private geometries = new Set<THREE.BufferGeometry>()
  private materials = new Set<THREE.Material>()
  private textures = new Set<THREE.Texture>()
  private disposed = false
  private data: GeoData
  private groundAt: (x: number, z: number) => number | null

  constructor(data: GeoData, groundAt: (x: number, z: number) => number | null) {
    this.data = data; this.groundAt = groundAt
    this.group.name = 'peekskill-source-backed-converted-buildings'
    this.group.add(this.originals, this.converted)
    this.group.visible = false
    this.ready = this.prepare()
  }

  private async prepare() {
    const started = performance.now()
    const response = await fetch('/models/osm2world/peekskill/buildings.glb')
    if (!response.ok) throw new Error(`转换建筑下载失败 ${response.status}`)
    const bytes = await response.arrayBuffer()
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('')
    if (hash !== convertedBuildingSha256) throw new Error('转换建筑内容与来源校验值不一致')
    const gltf = await new GLTFLoader().parseAsync(bytes, '/models/osm2world/peekskill/')
    gltf.scene.updateMatrixWorld(true)
    gltf.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      this.geometries.add(object.geometry)
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        this.materials.add(material)
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) this.textures.add(value)
      }
    })
    if (this.disposed) { this.release(); return }
    const nodes = new Map<string, THREE.Object3D>()
    gltf.scene.traverse(object => { if (typeof object.userData.osmId === 'string') nodes.set(object.userData.osmId, object) })
    const projection = convertedProjection(this.data)
    const convertedBuckets = new Map<THREE.Material, THREE.BufferGeometry[]>()
    const originalBuckets: THREE.BufferGeometry[] = []
    for (const [recordIndex, record] of convertedBuildingRecords.entries()) {
      const feature = this.data.features.find(feature => String(feature.id) === record.featureId)
      const sourceNode = nodes.get(record.osmId)
      if (!feature || !sourceNode || buildingStructureKind(feature) !== 'building' || Math.abs((buildingHeight(feature).metres ?? -1) - record.height) > 0.001) throw new Error(`转换建筑源记录不匹配 ${record.osmId}`)
      const x = (feature.bounds[0] + feature.bounds[2]) / 2, z = (feature.bounds[1] + feature.bounds[3]) / 2
      const ground = this.groundAt(x, z)
      if (ground === null || this.data.landAt(x, z, 'water')) throw new Error(`转换建筑没有可用地面 ${record.osmId}`)
      if (recordIndex === 0) this.focusPoint.set(x, ground + record.height / 2, z)
      const transform = new THREE.Matrix4().makeScale(projection.scale, 1, -projection.scale)
      transform.setPosition(projection.origin.x, ground, projection.origin.z)
      let alignmentError = 0, maxHeight = -Infinity, minHeight = Infinity
      sourceNode.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return
        if (Array.isArray(object.material)) throw new Error('转换建筑需要单材质 primitive')
        const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld).applyMatrix4(transform)
        // A north/south reflection reverses winding. Correct it once while
        // baking static buffers rather than making all imported faces double-sided.
        if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i))
        const index = geometry.index!
        for (let i = 0; i < index.count; i += 3) { const b = index.getX(i + 1); index.setX(i + 1, index.getX(i + 2)); index.setX(i + 2, b) }
        index.needsUpdate = true
        const positions = geometry.getAttribute('position')
        for (let i = 0; i < positions.count; i++) {
          const y = positions.getY(i) - ground
          minHeight = Math.min(minHeight, y); maxHeight = Math.max(maxHeight, y)
          if (Math.abs(y) < 0.01) {
            const px = positions.getX(i), pz = positions.getZ(i)
            // Ground vertices must lie on the archived footprint boundary.
            const error = Math.min(...feature.coordinates.map((a, j) => {
              const b = feature.coordinates[(j + 1) % feature.coordinates.length]
              const dx = b.x - a.x, dz = b.z - a.z
              const t = THREE.MathUtils.clamp(((px - a.x) * dx + (pz - a.z) * dz) / Math.max(dx * dx + dz * dz, 1e-12), 0, 1)
              return Math.hypot(px - a.x - t * dx, pz - a.z - t * dz)
            }))
            alignmentError = Math.max(alignmentError, error)
          }
        }
        const list = convertedBuckets.get(object.material) ?? []
        list.push(geometry); convertedBuckets.set(object.material, list)
        this.stats.triangles += index.count / 3
      })
      if (alignmentError > 0.02 || Math.abs(maxHeight - record.height) > 0.01 || Math.abs(minHeight) > 0.01) throw new Error(`转换建筑坐标或高度校验失败 ${record.osmId}: ${alignmentError.toFixed(3)}m / ${maxHeight.toFixed(3)}m`)
      this.stats.maxAlignmentErrorMetres = Math.max(this.stats.maxAlignmentErrorMetres, alignmentError)
      const shape = new THREE.Shape(feature.coordinates.map(point => new THREE.Vector2(point.x, -point.z)))
      for (const hole of feature.holes) shape.holes.push(new THREE.Path(hole.map(point => new THREE.Vector2(point.x, -point.z))))
      const original = new THREE.ExtrudeGeometry(shape, { depth: record.height, bevelEnabled: false, steps: 1 })
      applyBuildingAppearance(original, buildingAppearance(feature))
      original.rotateX(-Math.PI / 2); original.translate(0, ground - 0.1, 0)
      originalBuckets.push(original)
      this.stats.buildings++
    }
    for (const [material, geometries] of convertedBuckets) {
      const merged = mergeGeometries(geometries, false)
      if (!merged) throw new Error('转换建筑材质合批失败')
      merged.computeBoundingSphere(); this.geometries.add(merged)
      const mesh = new THREE.Mesh(merged, material)
      mesh.castShadow = true; mesh.receiveShadow = true
      this.converted.add(mesh); this.stats.meshes++
      geometries.forEach(geometry => geometry.dispose())
    }
    const original = mergeGeometries(originalBuckets, false)
    originalBuckets.forEach(geometry => geometry.dispose())
    if (!original) throw new Error('原建筑对照合批失败')
    this.geometries.add(original)
    const originalMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1 })
    this.materials.add(originalMaterial)
    const mesh = new THREE.Mesh(original, originalMaterial); mesh.receiveShadow = true
    this.originals.add(mesh)
    this.stats.ready = true; this.stats.prepareMs = performance.now() - started
  }

  setVisible(visible: boolean, converted: boolean) {
    this.group.visible = visible && this.stats.ready
    this.converted.visible = converted; this.originals.visible = !converted
  }
  private release() {
    this.geometries.forEach(geometry => geometry.dispose()); this.geometries.clear()
    this.materials.forEach(material => material.dispose()); this.materials.clear()
    this.textures.forEach(texture => texture.dispose()); this.textures.clear()
  }
  dispose() { this.disposed = true; this.release(); this.group.removeFromParent() }
}
