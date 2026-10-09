import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const FILES = {
  broadleaf: 'nature/tree_detailed.glb', oak: 'nature/tree_oak.glb',
  pine: 'nature/tree_pineRoundA.glb', tallPine: 'nature/tree_pineTallA.glb',
  rock: 'nature/rock_largeA.glb', boulder: 'nature/rock_largeB.glb', corn: 'nature/crops_cornStageD.glb',
  houseA: 'suburban/building-type-a.glb', houseB: 'suburban/building-type-c.glb', houseC: 'suburban/building-type-e.glb',
  lowriseA: 'commercial/building-a.glb', lowriseB: 'commercial/building-d.glb', lowriseC: 'commercial/building-h.glb',
  towerA: 'commercial/building-skyscraper-a.glb', towerB: 'commercial/building-skyscraper-b.glb', towerC: 'commercial/building-skyscraper-c.glb',
} as const
export type SceneryAsset = keyof typeof FILES
export interface SceneryPlacement { x: number; y: number; z: number; height: number; yaw: number }
interface AssetPart { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }

/** Load a small local CC0 catalogue once; chunks only own instance buffers.
 * Bounds are centred horizontally and normalized to one metre in height. */
export class SceneryAssets {
  private models = new Map<SceneryAsset, { parts: AssetPart[]; size: THREE.Vector3 }>()
  loaded = 0
  failed = 0
  readonly total = Object.keys(FILES).length
  private disposed = false
  async load() {
    const loader = new GLTFLoader()
    await Promise.all(Object.entries(FILES).map(async ([key, file]) => {
      try {
        const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/kenney/${file}`)
        const root = gltf.scene
        root.updateMatrixWorld(true)
        const bounds = new THREE.Box3().setFromObject(root)
        const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3())
        const scale = 1 / Math.max(size.y, 0.001)
        const normalize = new THREE.Matrix4().makeScale(scale, scale, scale)
          .multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z))
        const parts: AssetPart[] = []
        root.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return
          const geometry = object.geometry.clone().applyMatrix4(normalize.clone().multiply(object.matrixWorld))
          const tune = (source: THREE.Material) => {
            const material = source.clone()
            if (material instanceof THREE.MeshStandardMaterial) {
              material.metalness = 0; material.roughness = 0.95
              if (file.startsWith('nature/')) {
                if (/leaf/i.test(material.name)) material.color.set(/Dark/i.test(material.name) ? 0x3e6044 : 0x617c43)
                else if (/wood|bark/i.test(material.name)) material.color.set(0x77624c)
                else if (key === 'rock' || key === 'boulder') material.color.set(0x92968a)
              }
            }
            return material
          }
          const material = Array.isArray(object.material) ? object.material.map(tune) : tune(object.material)
          parts.push({ geometry, material })
          object.geometry.dispose()
          for (const m of Array.isArray(object.material) ? object.material : [object.material]) m.dispose()
        })
        this.models.set(key as SceneryAsset, { parts, size: size.multiplyScalar(scale) })
        this.loaded++
      } catch (error) {
        this.failed++
        console.warn(`Scenery asset failed: ${file}`, error)
      }
    }))
    if (this.disposed) this.dispose()
  }
  footprint(asset: SceneryAsset, height: number) {
    const size = this.models.get(asset)?.size
    return { width: (size?.x ?? 1.4) * height, depth: (size?.z ?? 1.2) * height }
  }
  addInstances(parent: THREE.Group, asset: SceneryAsset, placements: SceneryPlacement[]) {
    const model = this.models.get(asset)
    if (!model || !placements.length) return
    const transform = new THREE.Object3D()
    for (const part of model.parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, placements.length)
      mesh.name = `kenney-${asset}`
      mesh.userData.sharedTerrainResource = true
      for (let i = 0; i < placements.length; i++) {
        const p = placements[i]
        transform.position.set(p.x, p.y, p.z)
        transform.rotation.set(0, p.yaw, 0)
        transform.scale.setScalar(p.height)
        transform.updateMatrix()
        mesh.setMatrixAt(i, transform.matrix)
      }
      mesh.computeBoundingSphere()
      mesh.receiveShadow = true
      parent.add(mesh)
    }
  }
  dispose() {
    this.disposed = true
    const materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>()
    for (const model of this.models.values()) for (const part of model.parts) {
      part.geometry.dispose()
      for (const material of Array.isArray(part.material) ? part.material : [part.material]) materials.add(material)
    }
    for (const material of materials) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
      material.dispose()
    }
    for (const texture of textures) texture.dispose()
    this.models.clear()
  }
}
