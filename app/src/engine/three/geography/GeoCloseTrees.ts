import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { ForestPlacement } from './GeoForest'

export const TREE_ASSETS = {
  'scots-pine': { url: '/models/trees/mature-scots-pine-lod.glb', radiusMetres: 5.8, bytes: 537348, sha256: '133a9653917dd511ab0af062f997946cfd966dc09b4d9b8c381c671866c962b6' },
  'oak-street-tree': { url: '/models/trees/oak-street-tree-lod.glb', radiusMetres: 4.0, bytes: 708996, sha256: 'd65f2515da582174c0321cb9a349f119496ded36633454e29f3666ac3c0fdc02' },
  'phototextured-pine-native': { url: '/models/trees/polyhaven-pine-native.glb', radiusMetres: 4.2, bytes: 24328860, sha256: '5b3b8c30cf28937e5e5193602e76e48878a24f81b58377dbbf3d2587d60a3ee8' },
  'phototextured-pine-branch50': { url: '/models/trees/polyhaven-pine-branch50.glb', radiusMetres: 4.2, bytes: 23313556, sha256: '6d6dbf39b0f2d0099df6cb12bea32e0d4f43de19a76bbce9b0188eeb2d5bf6db' },
  'silver-birch': { url: '/models/trees/mature-silver-birch.glb', radiusMetres: 5, bytes: 4902236, sha256: 'd1832a237f9e5d3728c7c6dc6e8e8243ac2984e51abe102cdf12bb996ca3dcc7' },
  'canopy-ash-lod1': { url: '/models/trees/ash-large-lod1-20m.glb', radiusMetres: 13, bytes: 3172184, sha256: 'e942ff58523e3833b87fdb1d3fa3d04cd797a85e09434aef90881bee38d1d9eb' },
  'canopy-ash-lod2': { url: '/models/trees/ash-large-lod2-20m.glb', radiusMetres: 13, bytes: 2942720, sha256: '3441ea08b563c5d0f6c15432770420b0128caf79115afa5235a7f9429e012580' },
  'canopy-oak-lod1': { url: '/models/trees/oak-large-lod1-20m.glb', radiusMetres: 13, bytes: 3257564, sha256: '20443ef8c9d66adaaf92bc8fef48e7fc401dd747e220b79804da1f2f6704da79' },
  'canopy-oak-lod2': { url: '/models/trees/oak-large-lod2-20m.glb', radiusMetres: 13, bytes: 3039740, sha256: '5af0126c0e021da4c928c14da11ebe9409f63a943cd088810737d5f9158c0b06' },
} as const
const DEFAULT_CLOSE_RANGE_METRES = 115
const CELL_METRES = 40

const ASSETS = TREE_ASSETS
export type CloseTreeAssetId = keyof typeof TREE_ASSETS
export type CloseTreePlacement = ForestPlacement & { asset: CloseTreeAssetId }

// Immutable source bytes are shared by production and Debug Mode consumers.
// Each consumer parses its own materials/uniforms; neither can mutate the
// other's focus or dispose its model resources.
const assetBytes = new Map<CloseTreeAssetId, Promise<ArrayBuffer>>()
export function verifiedTreeBytes(asset: CloseTreeAssetId): Promise<ArrayBuffer> {
  const existing = assetBytes.get(asset)
  if (existing) return existing
  const pending = (async () => {
    const specification = TREE_ASSETS[asset]
    const response = await fetch(specification.url)
    if (!response.ok) throw new Error(`Tree asset ${asset}: HTTP ${response.status}`)
    const buffer = await response.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', buffer)
    const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
    if (buffer.byteLength !== specification.bytes || sha256 !== specification.sha256) throw new Error(`Tree asset ${asset}: source checksum mismatch`)
    return buffer
  })()
  assetBytes.set(asset, pending)
  return pending
}

// This same screen threshold is used by source models and their forest cards.
// Distance changes pixel coverage without multiplying source alpha before its
// cutoff, which would shrink crowns and leave a gap during the transition.
export const treeScreenThreshold = 'fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453)'

export interface CloseTreeStats {
  ready: boolean
  sourceMeshes: number
  sourceTriangles: number
  preparedTrees: number
  processedAssetBytes: number
  prepareMs: number
  visibleTrees: number
  visibleCells: number
  visibleDrawCalls: number
  visibleTriangles: number
  closeRangeMetres: number
  cellMetres: number
}

interface CellBatch {
  asset: CloseTreeAssetId
  group: THREE.Group
  count: number
  center: THREE.Vector2
  radiusMetres: number
  drawCalls: number
  triangles: number
}

interface Prototype {
  asset: CloseTreeAssetId
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

/**
 * Static close-range tree model instances. The checked-in GLB is fully local;
 * await prepare() before making the real world presentable. Placements are
 * visual samples from mapped woodland, never a surveyed individual-tree set.
 */
export class GeoCloseTrees {
  readonly root = new THREE.Group()
  readonly ready: Promise<void>
  readonly stats: CloseTreeStats
  readonly closeRangeMetres: number
  readonly cellMetres: number
  private cells: CellBatch[] = []
  private geometries = new Set<THREE.BufferGeometry>()
  private materials = new Set<THREE.Material>()
  private textures = new Set<THREE.Texture>()
  private farRoot: THREE.Object3D | null
  private closeVisible = true
  private assetFilter: Set<CloseTreeAssetId> | null = null
  private statsListeners = new Set<(stats: CloseTreeStats) => void>()
  private focus = new THREE.Vector2()

  constructor(
    placements: CloseTreePlacement[],
    options: { closeRangeMetres?: number; cellMetres?: number; farForestRoot?: THREE.Object3D } = {},
  ) {
    this.closeRangeMetres = options.closeRangeMetres ?? DEFAULT_CLOSE_RANGE_METRES
    this.cellMetres = options.cellMetres ?? CELL_METRES
    this.farRoot = options.farForestRoot ?? null
    this.root.name = 'real-forest-close-3d'
    this.root.userData.individualTreeLocationsEstimated = true
    this.root.visible = false
    this.stats = {
      ready: false, sourceMeshes: 0, sourceTriangles: 0, preparedTrees: placements.length,
      processedAssetBytes: 0, prepareMs: 0, visibleTrees: 0, visibleCells: 0,
      visibleDrawCalls: 0, visibleTriangles: 0, closeRangeMetres: this.closeRangeMetres,
      cellMetres: this.cellMetres,
    }
    this.ready = this.prepare(placements)
  }

  private async prepare(placements: CloseTreePlacement[]) {
    const startedAt = performance.now()
    const requestedAssets = [...new Set(placements.map(placement => placement.asset))]
    const loader = new GLTFLoader()
    const prototypes: Prototype[] = []
    await Promise.all(requestedAssets.map(async asset => {
      const buffer = await verifiedTreeBytes(asset)
      const gltf = await loader.parseAsync(buffer, '')
      const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>()
      gltf.scene.updateMatrixWorld(true)
      this.stats.processedAssetBytes += buffer.byteLength
      gltf.scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return
        const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld)
        this.stats.sourceMeshes++
        const indices = geometry.index?.count ?? geometry.getAttribute('position').count
        this.stats.sourceTriangles += Math.floor(indices / 3)
        if (Array.isArray(object.material)) throw new Error('Tree asset contains an unsupported material array')
        this.materials.add(object.material)
        object.geometry.dispose()
        // Instance centers stay in geographic metres despite the train's
        // parent transform. The source model keeps its authored dimensions.
        object.material.alphaHash = true
        object.material.onBeforeCompile = (shader: Parameters<THREE.Material['onBeforeCompile']>[0]) => {
          shader.uniforms.closeTreeFocus = { value: this.focus }
          shader.uniforms.closeTreeLimit = { value: this.closeRangeMetres }
          shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform vec2 closeTreeFocus;\nvarying float closeTreeDistance;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\ncloseTreeDistance = length(instanceMatrix[3].xz - closeTreeFocus);')
          shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float closeTreeLimit;\nvarying float closeTreeDistance;')
            .replace('#include <alphahash_fragment>', `if (${treeScreenThreshold} >= 1.0 - smoothstep(closeTreeLimit - 35.0, closeTreeLimit, closeTreeDistance)) discard;\n#include <alphahash_fragment>`)
        }
        object.material.customProgramCacheKey = () => 'geographic-close-trees-v2'
        for (const value of Object.values(object.material)) {
          if (value instanceof THREE.Texture) this.textures.add(value)
        }
        const parts = byMaterial.get(object.material) ?? []
        parts.push(geometry); byMaterial.set(object.material, parts)
      })
      for (const [material, parts] of byMaterial) {
        const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts, false)
        if (!geometry) throw new Error(`Tree asset ${asset}: incompatible material geometry`)
        if (parts.length > 1) parts.forEach(part => part.dispose())
        this.geometries.add(geometry)
        prototypes.push({ asset, geometry, material })
      }
      if (!prototypes.some(prototype => prototype.asset === asset)) throw new Error(`Tree asset ${asset} has no meshes`)
    }))

    const byCell = new Map<string, CloseTreePlacement[]>()
    for (const placement of placements) {
      const cx = Math.floor(placement.x / this.cellMetres)
      const cz = Math.floor(placement.z / this.cellMetres)
      const key = `${placement.asset}:${cx}:${cz}`
      const list = byCell.get(key) ?? []
      list.push(placement)
      byCell.set(key, list)
    }

    const transform = new THREE.Object3D()
    for (const [key, items] of byCell) {
      const [asset, cxRaw, czRaw] = key.split(':')
      const species = asset as CloseTreeAssetId
      const cx = Number(cxRaw), cz = Number(czRaw)
      const group = new THREE.Group()
      group.name = `close-tree-cell-${key}`
      group.visible = false
      const cell: CellBatch = {
        asset: species, group, count: items.length,
        center: new THREE.Vector2((cx + 0.5) * this.cellMetres, (cz + 0.5) * this.cellMetres),
        radiusMetres: ASSETS[species].radiusMetres,
        drawCalls: prototypes.filter(item => item.asset === species).length,
        triangles: prototypes.filter(item => item.asset === species).reduce((sum, item) => {
          const indices = item.geometry.index?.count ?? item.geometry.getAttribute('position').count
          return sum + Math.floor(indices / 3)
        }, 0),
      }
      for (const prototype of prototypes.filter(item => item.asset === species)) {
        const mesh = new THREE.InstancedMesh(prototype.geometry, prototype.material, items.length)
        mesh.castShadow = true; mesh.receiveShadow = true
        mesh.name = `source-${species}-instances`
        mesh.userData.individualTreeLocationsEstimated = true
        mesh.userData.asset = species
        mesh.userData.sharedGeometry = true
        for (let index = 0; index < items.length; index++) {
          const tree = items[index]
          transform.position.set(tree.x, tree.y, tree.z)
          transform.rotation.set(0, tree.yaw, 0)
          // Keep authored model dimensions. Do not inflate the smaller oak
          // street-tree form into mature forest canopy.
          transform.scale.setScalar(1)
          transform.updateMatrix()
          mesh.setMatrixAt(index, transform.matrix)
        }
        mesh.instanceMatrix.needsUpdate = true
        mesh.computeBoundingSphere()
        group.add(mesh)
      }
      this.root.add(group)
      this.cells.push(cell)
    }
    this.stats.ready = true
    this.stats.prepareMs = performance.now() - startedAt
    this.setFocus(this.lastFocus.x, this.lastFocus.y)
  }

  /** Change only static cell visibility; this creates no geometry or GPU assets. */
  setFocus(x: number, z: number) {
    this.lastFocus.set(x, z)
    this.focus.set(x, z)
    let visibleTrees = 0
    let visibleCells = 0
    let visibleDrawCalls = 0
    let visibleTriangles = 0
    for (const cell of this.cells) {
      const dx = cell.center.x - x, dz = cell.center.y - z
      const limit = this.closeRangeMetres + this.cellMetres * Math.SQRT1_2 + cell.radiusMetres
      const visible = this.closeVisible && (!this.assetFilter || this.assetFilter.has(cell.asset)) && dx * dx + dz * dz <= limit * limit
      cell.group.visible = visible
      if (visible) {
        visibleCells++; visibleTrees += cell.count
        visibleDrawCalls += cell.drawCalls
        visibleTriangles += cell.count * cell.triangles
      }
    }
    this.root.visible = this.closeVisible && this.stats.ready
    this.stats.visibleTrees = visibleTrees
    this.stats.visibleCells = visibleCells
    this.stats.visibleDrawCalls = visibleDrawCalls
    this.stats.visibleTriangles = visibleTriangles
    this.statsListeners.forEach(listener => listener(this.stats))
  }

  subscribeStats(listener: (stats: CloseTreeStats) => void) {
    this.statsListeners.add(listener)
    listener(this.stats)
    return () => this.statsListeners.delete(listener)
  }
  setVisible(visible: boolean) { this.closeVisible = visible }

  /** All variants are already loaded and GPU prepared; comparison changes visibility only. */
  setAssetFilter(assets: CloseTreeAssetId[] | null) {
    this.assetFilter = assets ? new Set(assets) : null
    this.setFocus(this.lastFocus.x, this.lastFocus.y)
  }

  /** Independent Debug Mode visibility controls for close 3D / far patch layers. */
  setDebugLayers(layers: { close3D: boolean; farPatches: boolean }) {
    this.closeVisible = layers.close3D
    if (this.farRoot) this.farRoot.visible = layers.farPatches
    this.root.visible = this.closeVisible && this.stats.ready
    this.setFocus(this.lastFocus.x, this.lastFocus.y)
  }

  setFarForestVisible(visible: boolean) {
    if (this.farRoot) this.farRoot.visible = visible
  }

  private lastFocus = new THREE.Vector2()

  dispose() {
    this.root.traverse(object => {
      if (object instanceof THREE.InstancedMesh) {
        object.dispose()
      }
    })
    this.geometries.forEach(geometry => geometry.dispose())
    this.geometries.clear()
    this.materials.forEach(material => material.dispose())
    this.materials.clear()
    this.textures.forEach(texture => texture.dispose())
    this.textures.clear()
    this.cells = []
  }
}

/** Mount these controls into the existing geographic Debug Mode panel. */
export function mountTreeLayerControls(
  parent: HTMLElement,
  closeTrees: GeoCloseTrees,
  farForestRoot: THREE.Object3D,
) {
  const section = document.createElement('fieldset')
  section.setAttribute('aria-label', '森林近远景对照')
  section.style.cssText = 'border:1px solid #d8dccb;border-radius:6px;margin:10px 0;padding:8px;font:11px/1.5 sans-serif;'
  const legend = document.createElement('legend')
  legend.textContent = '树木近远景隔离'
  section.append(legend)
  const update = () => {
    closeTrees.setDebugLayers({ close3D: close.checked, farPatches: far.checked })
    farForestRoot.visible = far.checked
  }
  const close = document.createElement('input')
  close.type = 'checkbox'; close.checked = true; close.setAttribute('aria-label', '显示近景三维树模型')
  close.onchange = update
  const far = document.createElement('input')
  far.type = 'checkbox'; far.checked = true; far.setAttribute('aria-label', '显示远景森林贴片')
  far.onchange = update
  for (const [input, label] of [[close, '近景 3D 树（中心 ≤115m）'], [far, '远景纹理林地']] as const) {
    const row = document.createElement('label')
    row.style.cssText = 'display:block;margin:3px 0;'
    row.append(input, document.createTextNode(` ${label}`)); section.append(row)
  }
  const note = document.createElement('small')
  note.textContent = '树木位置是森林面内的画面样本，不表示逐株测绘。'
  const readout = document.createElement('output')
  readout.setAttribute('aria-label', '近景树木模型资源与绘制诊断')
  readout.style.cssText = 'display:block;margin-top:5px;white-space:pre-line;'
  const unsubscribe = closeTrees.subscribeStats(stats => {
    readout.textContent = stats.ready
      ? `模型就绪 ${stats.processedAssetBytes.toLocaleString()} B · ${stats.sourceTriangles.toLocaleString()} 模型三角形\n准备 ${stats.preparedTrees.toLocaleString()} 株 / ${stats.prepareMs.toFixed(1)}ms · 可视 ${stats.visibleTrees} 株 / ${stats.visibleCells} 格\n当前 ${stats.visibleTriangles.toLocaleString()} 三角形 · ${stats.visibleDrawCalls} 合批绘制`
      : `近景模型准备中 · ${stats.preparedTrees.toLocaleString()} 个位置样本`
  })
  section.append(note, readout)
  parent.append(section)
  // Ensure checkboxes match the initial scene state.
  farForestRoot.visible = true
  closeTrees.setDebugLayers({ close3D: true, farPatches: true })
  return () => { unsubscribe(); section.remove() }
}

