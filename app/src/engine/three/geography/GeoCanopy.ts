import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { verifiedTreeBytes, TREE_ASSETS, treeScreenThreshold, type CloseTreeAssetId } from './GeoCloseTrees'
import type { ForestPlacement } from './GeoForest'

const ASSETS = ['canopy-ash-lod1', 'canopy-ash-lod2', 'canopy-oak-lod1', 'canopy-oak-lod2'] as const
const CELL_METRES = 64
const CLOSE_METRES = 115
interface Prototype { asset: CloseTreeAssetId; geometry: THREE.BufferGeometry; material: THREE.Material; triangles: number }
interface Cell { group: THREE.Group; center: THREE.Vector2; count: number; lod: number; triangles: number; draws: number }
interface PreparedChunk { cells: Cell[]; trees: number; gpuReady: boolean }

/** Source woodland contains visual tree samples, not surveyed tree points.
 * Fixed source GLBs load once before departure. Instance buffers are built
 * with the existing route-ahead chunks, uploaded/fenced while hidden, and
 * then retained until normal cache eviction. Movement only changes uniforms
 * and visibility, never model geometry or existing instance attributes. */
export class GeoCanopy {
  readonly ready: Promise<void>
  readonly stats = { ready: false, assetBytes: 0, sourceTriangles: 0, preparedTrees: 0,
    preparedChunks: 0, gpuPreparedTrees: 0, unpreparedVisibleTrees: 0, visibleTrees: 0, visibleDrawCalls: 0, visibleTriangles: 0,
    sourcePositionPolicy: 'existing-16m-woodland-samples', closeRangeMetres: CLOSE_METRES }
  private focus = new THREE.Vector2()
  private enabled = { value: 1 }
  private prototypes: Prototype[] = []
  private chunks = new Map<THREE.Group, PreparedChunk>()
  private geometries = new Set<THREE.BufferGeometry>()
  private materials = new Set<THREE.Material>()
  private textures = new Set<THREE.Texture>()

  constructor() { this.ready = this.prepare() }

  private async prepare() {
    const loader = new GLTFLoader()
    await Promise.all(ASSETS.map(async asset => {
      const bytes = await verifiedTreeBytes(asset)
      const gltf = await loader.parseAsync(bytes, '')
      this.stats.assetBytes += bytes.byteLength
      gltf.scene.updateMatrixWorld(true)
      const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>()
      gltf.scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return
        if (Array.isArray(object.material)) throw new Error(`Canopy ${asset}: unsupported material array`)
        const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld)
        object.geometry.dispose()
        const material = object.material
        const parts = byMaterial.get(material) ?? []
        parts.push(geometry); byMaterial.set(material, parts)
      })
      const lod = asset.endsWith('lod1') ? 1 : 2
      for (const [material, parts] of byMaterial) {
        const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts, false)
        if (!geometry) throw new Error(`Canopy ${asset}: incompatible source geometry`)
        if (parts.length > 1) parts.forEach(part => part.dispose())
        const triangles = Math.floor((geometry.index?.count ?? geometry.getAttribute('position').count) / 3)
        this.stats.sourceTriangles += triangles
        material.alphaHash = true
        material.onBeforeCompile = shader => {
          shader.uniforms.geoCanopyFocus = { value: this.focus }
          shader.uniforms.geoCanopyEnabled = this.enabled
          shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform vec2 geoCanopyFocus;\nvarying float geoCanopyDistance;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\ngeoCanopyDistance = length(instanceMatrix[3].xz - geoCanopyFocus);')
          shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float geoCanopyEnabled;\nvarying float geoCanopyDistance;')
            .replace('#include <alphahash_fragment>', `
float canopyPixel = ${treeScreenThreshold};
float canopyModelCoverage = 1.0 - smoothstep(80.0, 115.0, geoCanopyDistance);
float canopyLod2Coverage = smoothstep(35.0, 60.0, geoCanopyDistance);
if (geoCanopyEnabled < 0.5 || canopyPixel >= canopyModelCoverage) discard;
${lod === 1 ? 'if (canopyPixel < canopyLod2Coverage) discard;' : 'if (canopyPixel >= canopyLod2Coverage) discard;'}
#include <alphahash_fragment>`)
        }
        material.customProgramCacheKey = () => `geographic-canopy-lod-${lod}-v1`
        this.geometries.add(geometry); this.materials.add(material)
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) this.textures.add(value)
        this.prototypes.push({ asset, geometry, material, triangles })
      }
      if (!this.prototypes.some(prototype => prototype.asset === asset)) throw new Error(`Canopy ${asset}: no source meshes`)
    }))
    this.stats.ready = true
  }

  addInstances(chunk: THREE.Group, parent: THREE.Group, placements: ForestPlacement[]) {
    if (!this.stats.ready) throw new Error('Canopy prototypes must be prepared before woodland chunks')
    const batches = new Map<string, ForestPlacement[]>()
    for (const tree of placements) {
      const species = tree.variant % 2 === 0 ? 'ash' : 'oak'
      const key = `${species}:${Math.floor(tree.x / CELL_METRES)}:${Math.floor(tree.z / CELL_METRES)}`
      const items = batches.get(key) ?? []
      items.push(tree); batches.set(key, items)
    }
    const cells: Cell[] = []
    const transform = new THREE.Object3D()
    for (const [key, items] of batches) {
      const [species, cx, cz] = key.split(':')
      for (const lod of [1, 2]) {
        const asset = `canopy-${species}-lod${lod}` as CloseTreeAssetId
        const models = this.prototypes.filter(prototype => prototype.asset === asset)
        const group = new THREE.Group(); group.name = `prepared-canopy-${key}-lod${lod}`
        const cell: Cell = { group, center: new THREE.Vector2((Number(cx) + 0.5) * CELL_METRES, (Number(cz) + 0.5) * CELL_METRES),
          count: items.length, lod, triangles: models.reduce((sum, prototype) => sum + prototype.triangles, 0), draws: models.length }
        for (const prototype of models) {
          const mesh = new THREE.InstancedMesh(prototype.geometry, prototype.material, items.length)
          mesh.name = `woodland-${asset}`
          mesh.userData.sharedGeometry = true
          mesh.userData.individualTreeLocationsEstimated = true
          mesh.userData.asset = asset
          // Do not draw two complete LOD crowns into the shadow map. Leaf
          // source transparency and ordinary lighting remain intact.
          mesh.receiveShadow = true
          for (let i = 0; i < items.length; i++) {
            const tree = items[i]
            transform.position.set(tree.x, tree.y, tree.z)
            transform.rotation.set(0, tree.yaw, 0); transform.scale.setScalar(1)
            transform.updateMatrix(); mesh.setMatrixAt(i, transform.matrix)
          }
          mesh.instanceMatrix.needsUpdate = true
          mesh.computeBoundingSphere(); group.add(mesh)
        }
        cells.push(cell); parent.add(group)
        this.updateCell(cell)
      }
    }
    this.chunks.set(chunk, { cells, trees: placements.length, gpuReady: false })
    this.stats.preparedTrees += placements.length; this.stats.preparedChunks = this.chunks.size
  }

  private updateCell(cell: Cell) {
    const distance = cell.center.distanceTo(this.focus)
    // Conservative spatial culling includes cell jitter and source crown
    // radius. Exact per-tree LOD/card coverage is evaluated in the shader.
    const extent = CELL_METRES * Math.SQRT1_2 + TREE_ASSETS['canopy-ash-lod1'].radiusMetres
    cell.group.visible = this.enabled.value > 0.5 && distance - extent < CLOSE_METRES
      && (cell.lod === 1 ? distance - extent < 60 : distance + extent > 35)
  }

  setFocus(x: number, z: number, enabled: boolean) {
    this.focus.set(x, z); this.enabled.value = enabled ? 1 : 0
    this.stats.visibleTrees = this.stats.visibleDrawCalls = this.stats.visibleTriangles = 0
    this.stats.unpreparedVisibleTrees = 0
    for (const [chunk, prepared] of this.chunks) {
      if (!chunk.visible) continue
      if (!prepared.gpuReady && enabled) this.stats.unpreparedVisibleTrees += prepared.trees
      for (const cell of prepared.cells) {
        this.updateCell(cell)
        if (!cell.group.visible) continue
        this.stats.visibleTrees += cell.count
        this.stats.visibleDrawCalls += cell.draws
        this.stats.visibleTriangles += cell.count * cell.triangles
      }
    }
  }

  markGpuChunks(chunks: THREE.Group[]) {
    for (const chunk of chunks) {
      const prepared = this.chunks.get(chunk)
      if (prepared && !prepared.gpuReady) {
        prepared.gpuReady = true; this.stats.gpuPreparedTrees += prepared.trees
      }
    }
  }

  releaseChunk(chunk: THREE.Group) {
    const prepared = this.chunks.get(chunk)
    if (!prepared) return
    this.stats.preparedTrees -= prepared.trees
    if (prepared.gpuReady) this.stats.gpuPreparedTrees -= prepared.trees
    this.chunks.delete(chunk); this.stats.preparedChunks = this.chunks.size
  }

  dispose() {
    this.chunks.clear()
    this.geometries.forEach(geometry => geometry.dispose())
    this.materials.forEach(material => material.dispose())
    this.textures.forEach(texture => texture.dispose())
  }
}
