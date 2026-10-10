import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { hash01 } from '../core/procedural'
import type { MappedFeature } from './GeoData'
import { GeoDetailCoverage, detailCoverageDeclarations, detailCoverageLookup } from './GeoDetailCoverage'

export interface GamePlacement { x: number; y: number; z: number; height: number; yaw: number; variant: number }
interface Template { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }
const townNames = ['wall', 'wall-wood', 'wall-window-small', 'wall-window-shutters', 'wall-door', 'wall-detail-cross', 'wall-wood-detail-diagonal', 'roof-gable', 'roof-high-gable', 'chimney']
const natureNames = ['tree_fat', 'tree_pineRoundA', 'tree_default', 'plant_bushDetailed', 'plant_bushSmall', 'grass_large', 'grass_leafs', 'rock_largeA', 'rock_smallA']
/** Original CC0 meshes are retained beside their license and byte hashes. Three
 * assembled houses and recolored vegetation are artist interpretations only. */
export class GeoGameAssets {
  readonly ready: Promise<void>
  readonly templates = new Map<string, Template>()
  readonly focus = { value: new THREE.Vector2() }
  loadedAssets = 0
  assetBytes = 0
  housesPlaced = 0
  treesPlaced = 0
  groundcoverPlaced = 0
  readyState = false
  private disposed = false
  private materials = new Set<THREE.MeshStandardMaterial>()
  private coverage: GeoDetailCoverage
  constructor(coverage: GeoDetailCoverage) { this.coverage = coverage; this.ready = this.load() }
  private async load() {
    const root = `${import.meta.env.BASE_URL}models/fantasy/`
    const manifest = await fetch(`${root}manifest.json`).then(r => { if (!r.ok) throw new Error('Game asset manifest unavailable'); return r.json() }) as { files: Array<{ path: string; bytes: number; sha256: string }> }
    const textureRecord = manifest.files.find(file => file.path === 'town/Textures/colormap.png')!
    const textureBytes = await fetch(`${root}${textureRecord.path}`).then(r => { if (!r.ok) throw new Error('Town palette unavailable'); return r.arrayBuffer() })
    const textureSha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', textureBytes))].map(v => v.toString(16).padStart(2, '0')).join('')
    if (textureBytes.byteLength !== textureRecord.bytes || textureSha !== textureRecord.sha256) throw new Error('Town palette verification failed')
    this.assetBytes += textureBytes.byteLength
    const textureUrl = URL.createObjectURL(new Blob([textureBytes], { type: 'image/png' }))
    try {
      const manager = new THREE.LoadingManager()
      manager.setURLModifier(url => url.endsWith('Textures/colormap.png') ? textureUrl : url)
      const loader = new GLTFLoader(manager), town = new Map<string, Template>()
      await Promise.all([...townNames.map(name => `town/${name}`), ...natureNames.map(name => `nature/${name}`)].map(async name => {
        const file = manifest.files.find(file => file.path === `${name}.glb`)!
        const bytes = await fetch(`${root}${name}.glb`).then(r => { if (!r.ok) throw new Error(`Game mesh unavailable: ${name}`); return r.arrayBuffer() })
        const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('')
        if (bytes.byteLength !== file.bytes || sha !== file.sha256) throw new Error(`Game asset verification failed: ${name}`)
        const gltf = await loader.parseAsync(bytes, `${root}${name.startsWith('town/') ? 'town/' : 'nature/'}`)
        // parseAsync can resolve before referenced PNGs decode. The loader's
        // shared manager is awaited below before these templates become ready.
        gltf.scene.updateMatrixWorld(true)
        const parts: THREE.BufferGeometry[] = []
        let sourceMaterial: THREE.MeshStandardMaterial | undefined
        gltf.scene.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return
          const material = (Array.isArray(object.material) ? object.material[0] : object.material) as THREE.MeshStandardMaterial
          sourceMaterial ??= material
          const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld).toNonIndexed()
          for (const key of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv'].includes(key)) geometry.deleteAttribute(key)
          if (!geometry.getAttribute('uv')) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2))
          if (name.startsWith('nature/')) {
            const isLeaf = /leaf|green|grass|plant/i.test(material.name)
            const color = new THREE.Color(isLeaf ? (name.includes('grass') ? 0x7d9755 : 0x51774b) : /wood|bark/i.test(material.name) ? 0x493f32 : 0x727d78)
            const colors: number[] = []
            for (let i = 0; i < geometry.getAttribute('position').count; i++) colors.push(color.r, color.g, color.b)
            geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
          }
          parts.push(geometry)
        })
        const geometry = mergeGeometries(parts, false)!
        parts.forEach(p => p.dispose())
        const material = name.startsWith('town/') ? sourceMaterial! : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
        material.metalness = 0; material.roughness = 0.95; this.materials.add(material)
        if (this.disposed) { geometry.dispose(); material.dispose(); return }
        if (name.startsWith('town/')) town.set(name.slice(5), { geometry, material })
        else {
          geometry.computeBoundingBox()
          const box = geometry.boundingBox!, size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3())
          geometry.translate(-center.x, -box.min.y, -center.z); geometry.scale(1 / size.y, 1 / size.y, 1 / size.y)
          this.templates.set(name.slice(7), { geometry, material })
        }
        this.loadedAssets++; this.assetBytes += bytes.byteLength
      }))
      // Town texture is an external original PNG; wait for its image, not just
      // the mesh parse. GLTFLoader caches it across all modular models.
      const textures = [...this.materials].map(m => m.map).filter((t): t is THREE.Texture => !!t)
      await Promise.all(textures.map(t => t.image instanceof HTMLImageElement && !t.image.complete ? t.image.decode() : Promise.resolve()))
      for (let variant = 0; variant < 3; variant++) { this.assembleHouse(town, variant); this.assembleHouse(town, variant, true) }
      for (const template of town.values()) template.geometry.dispose()
      this.readyState = !this.disposed
    } finally { URL.revokeObjectURL(textureUrl) }
  }
  private assembleHouse(town: Map<string, Template>, variant: number, simplified = false) {
    const parts: THREE.BufferGeometry[] = [], width = variant === 2 ? 7.5 : 6, depth = variant === 1 ? 9 : 7, floors = variant === 0 ? 1 : 2, floorHeight = 2.8
    const add = (name: string, position: THREE.Vector3, scale: THREE.Vector3, yaw = 0) => {
      const geometry = town.get(name)!.geometry.clone()
      geometry.scale(scale.x, scale.y, scale.z); geometry.rotateY(yaw); geometry.translate(position.x, position.y, position.z); parts.push(geometry)
    }
    // Walls are native one-unit panels whose outside face is x=0.5. Four
    // rotations form closed houses; fenestration stays human-scale.
    for (let side = 0; side < 4; side++) {
      const length = side % 2 ? width : depth, across = simplified && side !== 0 ? 1 : Math.ceil(length / 2.8), panel = length / across
      const yaw = side * Math.PI / 2
      for (let floor = 0; floor < floors; floor++) for (let col = 0; col < across; col++) {
        const local = new THREE.Vector3((side % 2 ? depth : width) / 2 - 0.5 * 2.8, 0.65 + floor * floorHeight, -length / 2 + panel * (col + 0.5)).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
        local.y = 0.65 + floor * floorHeight
        const name = simplified && side !== 0 ? (variant === 2 ? 'wall-wood-detail-diagonal' : 'wall-detail-cross') : side === 0 && floor === 0 && col === Math.floor(across / 2) ? 'wall-door' : col % 2 === 0 ? (variant === 1 && !simplified ? 'wall-window-shutters' : 'wall-window-small') : variant === 2 ? 'wall-wood-detail-diagonal' : 'wall-detail-cross'
        add(name, local, new THREE.Vector3(2.8, floorHeight, panel), yaw)
      }
    }
    // Native roof-gable's ridge follows X. Rotate it to the house's depth
    // axis and fit one complete roof, preserving the original UV/material.
    // Repeating the unrotated segment along Z would create parallel peaks.
    const roofName = variant === 1 ? 'roof-high-gable' : 'roof-gable'
    const roof = town.get(roofName)!.geometry.clone().rotateY(Math.PI / 2)
    roof.computeBoundingBox()
    const roofBox = roof.boundingBox!, size = roofBox.getSize(new THREE.Vector3())
    const ridgeRise = variant === 1 ? 3 : 2.3, roofBase = 0.65 + floorHeight * floors
    roof.translate(0, -roofBox.min.y, 0)
    roof.scale((width + 0.65) / size.x, ridgeRise / size.y, (depth + 0.65) / size.z)
    roof.translate(0, roofBase, 0)
    const roofVertexStart = parts.reduce((sum, part) => sum + part.getAttribute('position').count, 0)
    parts.push(roof)
    add('chimney', new THREE.Vector3(width * 0.18, 0.65 + floorHeight * floors + ridgeRise * 0.4, -depth * 0.22), new THREE.Vector3(2, 2.5, 2))
    const geometry = mergeGeometries(parts, false)!, material = town.get('wall')!.material
    parts.forEach(p => p.dispose())
    geometry.computeBoundingBox()
    geometry.userData.roofTop = roofBase + ridgeRise
    geometry.userData.roofVertexStart = roofVertexStart
    geometry.userData.roofVertexCount = roof.getAttribute('position').count
    this.templates.set(`${simplified ? 'houseLod' : 'house'}${variant}`, { geometry, material })
    if (simplified) return
    const foundation = new THREE.BoxGeometry(width, 0.8, depth).toNonIndexed(); foundation.translate(0, 0.25, 0)
    const stone = new THREE.MeshStandardMaterial({ color: 0x77786c, roughness: 1 }); this.materials.add(stone)
    this.templates.set(`foundation${variant}`, { geometry: foundation, material: stone })
  }
  addBatch(parent: THREE.Group, name: string, placements: GamePlacement[], distant = false) {
    if (!placements.length) return
    const template = this.templates.get(name)!, material = distant ? this.distantMaterial(template.material) : template.material
    const mesh = new THREE.InstancedMesh(template.geometry, material, placements.length), matrix = new THREE.Object3D()
    mesh.userData.sharedGeometry = true; mesh.userData.gameAsset = name; mesh.castShadow = !distant; mesh.receiveShadow = true
    for (const [i, p] of placements.entries()) {
      matrix.position.set(p.x, p.y, p.z); matrix.rotation.set(0, p.yaw, 0); matrix.scale.setScalar(p.height); matrix.updateMatrix(); mesh.setMatrixAt(i, matrix.matrix)
      // Palette variation is deterministic and independent of camera travel.
      mesh.setColorAt(i, new THREE.Color().setRGB(0.86 + hash01(p.x, p.z, 17) * 0.22, 0.90 + hash01(p.x, p.z, 18) * 0.15, 0.86 + hash01(p.x, p.z, 19) * 0.18))
    }
    mesh.computeBoundingSphere(); parent.add(mesh)
    if (name.startsWith('tree')) this.treesPlaced += placements.length
    else if (!name.startsWith('house') && !name.startsWith('foundation')) this.groundcoverPlaced += placements.length
  }
  private distantMaterials = new Map<THREE.Material, THREE.MeshStandardMaterial>()
  private distantMaterial(source: THREE.MeshStandardMaterial) {
    const cached = this.distantMaterials.get(source); if (cached) return cached
    const material = source.clone()
    material.onBeforeCompile = shader => {
      shader.uniforms.geoDetailCoverage = { value: this.coverage.texture }; shader.uniforms.geoDetailMinTile = { value: this.coverage.minTile }; shader.uniforms.gameFocus = this.focus
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 gameWorldXZ;').replace('#include <begin_vertex>', '#include <begin_vertex>\ngameWorldXZ = (instanceMatrix * vec4(position,1.0)).xz;')
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec2 gameWorldXZ; uniform vec2 gameFocus;\n${detailCoverageDeclarations}`).replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${detailCoverageLookup('gameWorldXZ')}\nif (geoDetailReady > 0.5 || distance(gameWorldXZ,gameFocus)>2600.0) discard;`)
    }
    material.customProgramCacheKey = () => 'fantasy-distant-canopy-coverage-v1'; this.materials.add(material); this.distantMaterials.set(source, material); return material
  }
  addHouses(parent: THREE.Group, features: MappedFeature[], groundAt: (x: number, z: number) => number | null, distant = false) {
    const groups: GamePlacement[][] = [[], [], []]
    for (const feature of features) {
      const x = (feature.bounds[0] + feature.bounds[2]) / 2, z = (feature.bounds[1] + feature.bounds[3]) / 2, y = groundAt(x, z)
      if (y === null) continue
      let longest = 0, yaw = 0
      for (let i = 1; i < feature.coordinates.length; i++) {
        const a = feature.coordinates[i - 1], b = feature.coordinates[i], length = Math.hypot(b.x - a.x, b.z - a.z)
        if (length > longest) { longest = length; yaw = Math.atan2(b.x - a.x, b.z - a.z) }
      }
      const variant = Math.min(2, Math.floor(hash01(x, z, 51) * 3))
      const template = this.templates.get(`house${variant}`)!.geometry
      const top = template.boundingBox!.max.y, roofTop = template.userData.roofTop as number
      // The -0.15m placement inset is included in these actual world-height
      // constraints. Keep roof ridge >=5m and every vertex (chimney too) <=12m.
      const minimumScale = Math.max(0.8, (5 + 0.15 + 0.001) / roofTop)
      const maximumScale = Math.min(1.15, (12 + 0.15) / top)
      const scale = THREE.MathUtils.clamp(Math.sqrt((feature.bounds[2] - feature.bounds[0]) * (feature.bounds[3] - feature.bounds[1])) / 8, minimumScale, maximumScale)
      groups[variant].push({ x, y: y - 0.15, z, yaw, height: scale, variant }); this.housesPlaced++
    }
    const group = new THREE.Group(); group.userData.geoLayer = 'building'; parent.add(group)
    group.userData.sourceHouseCount = groups.reduce((count, placements) => count + placements.length, 0)
    groups.forEach((placements, variant) => {
      if (!distant) {
        this.addBatch(group, `house${variant}`, placements)
        const full = group.children.at(-1)
        if (placements.length && full) full.userData.houseDetail = 'full'
      }
      this.addBatch(group, `houseLod${variant}`, placements, distant)
      const low = group.children.at(-1)
      if (placements.length && low && !distant) { low.userData.houseDetail = 'low'; low.visible = false }
      this.addBatch(group, `foundation${variant}`, placements, distant)
    })
  }
  /** Geometry LOD only: both batches share source anchors, matrices, roofs,
   * palette and silhouette. Far houses omit repeated small side-wall panels.
   * All instance buffers are prepared by the same genuine GPU fence gate. */
  setHouseDetail(parent: THREE.Group, cameraPosition: THREE.Vector3) {
    parent.traverse(object => {
      if (!(object instanceof THREE.InstancedMesh) || !object.userData.houseDetail || !object.boundingSphere) return
      const near = object.boundingSphere.center.distanceTo(cameraPosition) < 220
      object.visible = object.userData.houseDetail === 'full' ? near : !near
    })
  }
  release(parent: THREE.Group) {
    parent.traverse(object => {
      if (object.userData.sourceHouseCount) this.housesPlaced -= object.userData.sourceHouseCount
      if (object instanceof THREE.InstancedMesh && object.userData.gameAsset) {
      const name = object.userData.gameAsset as string
      if (name.startsWith('tree')) this.treesPlaced -= object.count
      else if (!name.startsWith('foundation') && !name.startsWith('house')) this.groundcoverPlaced -= object.count
    } })
  }
  dispose() { this.disposed = true; for (const t of this.templates.values()) t.geometry.dispose(); for (const m of this.materials) { m.map?.dispose(); m.dispose() } }
}
