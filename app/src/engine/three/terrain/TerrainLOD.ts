import * as THREE from 'three'
import { TerrainGen, TRACK_FLAT_HALF } from './TerrainGen'
import type { BiomeType, BiomeColors, HeightParams } from './Biome'
import { getBiomeConfig } from './Biome'

interface Chunk {
  mesh: THREE.Mesh
  decorations: THREE.Object3D[]
  x: number
  z: number
  lod: number
}

const CHUNK_SIZE = 256
const CHUNKS_BEHIND_Z = 2 // chunks behind the camera along travel (+Z)
const CHUNKS_AHEAD_Z = 2 // chunks ahead of the camera along travel (+Z)
const CHUNKS_VIEW_X = 3 // chunks in the view direction (+X side window)
const UPDATE_INTERVAL = 10 // frames
const SEGMENT_LENGTH = 2000 // travel distance per biome
const BLEND_LENGTH = 500 // transition distance between biomes
const BIOME_ORDER: BiomeType[] = ['field', 'forest', 'mountain', 'river', 'town']
const BALLAST_LIGHT = 0x8a8078
const BALLAST_DARK = 0x5f564c

/** Deterministic per-position hash, used for gravel speckle. */
function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453
  return s - Math.floor(s)
}

export class TerrainLOD {
  private parent: THREE.Object3D
  private terrainGen = new TerrainGen()
  private chunks = new Map<string, Chunk>()
  private frameCount = 0
  private material: THREE.MeshStandardMaterial

  // Biome transition state
  private currentBiome: BiomeType
  private nextBiome: BiomeType
  private segmentStartZ: number
  private activeParams: HeightParams
  private activeColors: BiomeColors
  private activeDecorDensity: number

  // Scratch objects for frustum culling
  private frustum = new THREE.Frustum()
  private projScreen = new THREE.Matrix4()
  private chunkBox = new THREE.Box3()

  // Shared shadow disc for fake AO under trees and buildings
  private shadowDisc = (() => {
    const g = new THREE.CircleGeometry(1, 8)
    g.rotateX(-Math.PI / 2)
    return {
      geom: g,
      mat: new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false,
      }),
    }
  })()

  constructor(scene: THREE.Object3D, biome: BiomeType = 'field') {
    this.parent = scene
    this.currentBiome = biome
    this.nextBiome = this.pickNextBiome(biome)
    this.segmentStartZ = 0

    const config = getBiomeConfig(biome)
    this.activeParams = { ...config.heightParams }
    this.activeColors = { ...config.colors }
    this.activeDecorDensity = config.decorDensity

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.0,
      flatShading: true,
    })
  }

  update(cameraPos: THREE.Vector3) {
    this.updateBiomeTransition(cameraPos.z)

    this.frameCount++
    if (this.frameCount % UPDATE_INTERVAL !== 0) return

    const cx = Math.floor(cameraPos.x / CHUNK_SIZE)
    const cz = Math.floor(cameraPos.z / CHUNK_SIZE)

    const needed = new Set<string>()

    // Camera travels along +Z and looks toward +X (side window).
    // Grid: straddle the track on Z, extend outward on +X.
    for (let dz = -CHUNKS_BEHIND_Z; dz < CHUNKS_AHEAD_Z; dz++) {
      for (let dx = 0; dx < CHUNKS_VIEW_X; dx++) {
        const chunkX = cx + dx
        const chunkZ = cz + dz
        const key = `${chunkX},${chunkZ}`
        needed.add(key)

        if (!this.chunks.has(key)) {
          this.createChunk(chunkX, chunkZ, cameraPos)
        }
      }
    }

    // Remove distant chunks
    for (const [key, chunk] of this.chunks) {
      if (!needed.has(key)) {
        this.removeChunk(chunk)
        this.chunks.delete(key)
      }
    }
  }

  /** Manual frustum culling: hide chunks outside the view before render. */
  applyFrustumCulling(camera: THREE.Camera) {
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.projScreen)
    for (const chunk of this.chunks.values()) {
      this.chunkBox.setFromObject(chunk.mesh)
      chunk.mesh.visible = this.frustum.intersectsBox(this.chunkBox)
    }
  }

  getCurrentBiome(): BiomeType {
    return this.currentBiome
  }

  /** Number of currently active terrain chunks. */
  get chunkCount(): number {
    return this.chunks.size
  }

  /** The Z position where the current biome segment began. */
  get zSegmentStart(): number {
    return this.segmentStartZ
  }

  /** Current biome name (the segment the camera is inside). */
  get currentBiomeName(): BiomeType {
    return this.currentBiome
  }

  /** Next biome name (beginning at segmentStartZ + SEGMENT_LENGTH). */
  get nextBiomeName(): BiomeType {
    return this.nextBiome
  }

  /** Length of one biome segment in world units. */
  static readonly SEGMENT_LENGTH = SEGMENT_LENGTH

  /** Length of the blend transition between two segments. */
  static readonly BLEND_LENGTH = BLEND_LENGTH

  /** World-space terrain height under the current (possibly blending) biome. */
  sampleHeight(x: number, z: number): number {
    return this.terrainGen.getHeight(x, z, this.activeParams)
  }

  private rgbToHex(c: { r: number; g: number; b: number }): number {
    return (
      (Math.round(c.r * 255) << 16) |
      (Math.round(c.g * 255) << 8) |
      Math.round(c.b * 255)
    )
  }

  // ---- Biome transitions ----

  private pickNextBiome(after: BiomeType): BiomeType {
    const index = BIOME_ORDER.indexOf(after)
    return BIOME_ORDER[(index + 1) % BIOME_ORDER.length]
  }

  private updateBiomeTransition(cameraZ: number) {
    // Advance to the next biome when the segment is fully travelled
    if (cameraZ >= this.segmentStartZ + SEGMENT_LENGTH) {
      this.segmentStartZ += SEGMENT_LENGTH
      this.currentBiome = this.nextBiome
      this.nextBiome = this.pickNextBiome(this.currentBiome)
    }

    const blendStart = this.segmentStartZ + SEGMENT_LENGTH - BLEND_LENGTH
    const rawT = THREE.MathUtils.clamp((cameraZ - blendStart) / BLEND_LENGTH, 0, 1)
    const t = THREE.MathUtils.smoothstep(rawT, 0, 1)

    const from = getBiomeConfig(this.currentBiome)
    const to = getBiomeConfig(this.nextBiome)
    this.activeParams = this.lerpParams(from.heightParams, to.heightParams, t)
    this.activeColors = this.lerpColors(from.colors, to.colors, t)
    this.activeDecorDensity = THREE.MathUtils.lerp(from.decorDensity, to.decorDensity, t)
  }

  private lerpParams(a: HeightParams, b: HeightParams, t: number): HeightParams {
    return {
      baseHeight: THREE.MathUtils.lerp(a.baseHeight, b.baseHeight, t),
      amplitude: THREE.MathUtils.lerp(a.amplitude, b.amplitude, t),
      frequency: THREE.MathUtils.lerp(a.frequency, b.frequency, t),
      octaves: Math.round(THREE.MathUtils.lerp(a.octaves, b.octaves, t)),
      persistence: THREE.MathUtils.lerp(a.persistence, b.persistence, t),
    }
  }

  private lerpColors(a: BiomeColors, b: BiomeColors, t: number): BiomeColors {
    const result = {} as BiomeColors
    const ca = new THREE.Color()
    const cb = new THREE.Color()
    for (const key of Object.keys(a) as (keyof BiomeColors)[]) {
      ca.setHex(a[key])
      cb.setHex(b[key])
      result[key] = ca.lerp(cb, t).getHex()
    }
    return result
  }

  // ---- Chunk lifecycle ----

  private removeChunk(chunk: Chunk) {
    this.parent.remove(chunk.mesh)
    chunk.mesh.geometry.dispose()

    for (const decor of chunk.decorations) {
      this.parent.remove(decor)
      this.disposeDecoration(decor)
    }
  }

  private disposeDecoration(decor: THREE.Object3D) {
    decor.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose())
        } else {
          obj.material.dispose()
        }
      }
    })
  }

  /** Attach a dark semi-transparent disc under a decor to fake ambient occlusion. */
  private addShadow(parent: THREE.Object3D, radius: number) {
    const disc = new THREE.Mesh(this.shadowDisc.geom, this.shadowDisc.mat)
    disc.scale.setScalar(radius)
    disc.position.y = 0.02
    disc.renderOrder = 1
    parent.add(disc)
  }

  private createChunk(cx: number, cz: number, cameraPos: THREE.Vector3) {
    const worldX = cx * CHUNK_SIZE
    const worldZ = cz * CHUNK_SIZE

    const dist = Math.sqrt(
      (worldX + CHUNK_SIZE / 2 - cameraPos.x) ** 2 +
      (worldZ + CHUNK_SIZE / 2 - cameraPos.z) ** 2
    )

    let resolution: number
    if (dist < CHUNK_SIZE * 1.5) {
      resolution = 64
    } else if (dist < CHUNK_SIZE * 3) {
      resolution = 32
    } else {
      resolution = 16
    }

    const geometry = new THREE.PlaneGeometry(
      CHUNK_SIZE,
      CHUNK_SIZE,
      resolution,
      resolution
    )
    geometry.rotateX(-Math.PI / 2)

    const positions = geometry.attributes.position.array as Float32Array
    const colors = new Float32Array(positions.length)
    const params = this.activeParams
    const cols = this.activeColors

    const centerX = worldX + CHUNK_SIZE / 2
    const centerZ = worldZ + CHUNK_SIZE / 2

    for (let i = 0; i < positions.length; i += 3) {
      // Sample in world coordinates: the track corridor flattening and the
      // noise field are both defined in world space, not chunk-local space.
      const x = positions[i] + centerX
      const z = positions[i + 2] + centerZ
      const h = this.terrainGen.getHeight(x, z, params)
      positions[i + 1] = h

      const slope = this.terrainGen.getSlope(x, z, params)
      let color = this.computeVertexColor(h, slope, cols, params)

      // Ballast coloring: paint the flattened rail corridor with gravel
      // speckle (two tones hashed per-vertex) so the near ground reads as
      // crushed stone instead of a flat slab.
      const dist = Math.abs(x)
      if (dist < TRACK_FLAT_HALF + 3) {
        const t = THREE.MathUtils.smoothstep(
          (dist - TRACK_FLAT_HALF + 2) / 5, 0, 1
        )
        const gravelTone = hash2(x, z) > 0.5 ? BALLAST_LIGHT : BALLAST_DARK
        color = this.lerpColor(gravelTone, this.rgbToHex(color), t)
      }
      colors[i] = color.r
      colors[i + 1] = color.g
      colors[i + 2] = color.b
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.computeVertexNormals()

    const mesh = new THREE.Mesh(geometry, this.material)
    mesh.position.set(centerX, 0, centerZ)
    mesh.castShadow = true
    mesh.receiveShadow = true

    this.parent.add(mesh)
    // Distant (low-res) chunks get fewer decorations
    const densityScale = resolution === 64 ? 1 : resolution === 32 ? 0.5 : 0.25
    const decorations = this.createDecorations(worldX, worldZ, params, densityScale)
    for (const decor of decorations) {
      this.parent.add(decor)
    }
    this.chunks.set(`${cx},${cz}`, { mesh, decorations, x: cx, z: cz, lod: resolution })
  }

  private createDecorations(
    worldX: number,
    worldZ: number,
    params: HeightParams,
    densityScale: number
  ): THREE.Object3D[] {
    const decorations: THREE.Object3D[] = []
    const attempts = Math.floor(this.activeDecorDensity * 80 * densityScale)

    for (let i = 0; i < attempts; i++) {
      const x = worldX + Math.random() * CHUNK_SIZE
      const z = worldZ + Math.random() * CHUNK_SIZE

      // Keep the rail corridor clear of trees/rocks
      if (Math.abs(x) < TRACK_FLAT_HALF + 4) continue

      const height = this.terrainGen.getHeight(x, z, params)
      const slope = this.terrainGen.getSlope(x, z, params)

      if (slope >= 2) continue

      let tooClose = false
      for (const decor of decorations) {
        const dx = decor.position.x - x
        const dz = decor.position.z - z
        if (Math.sqrt(dx * dx + dz * dz) < 15) {
          tooClose = true
          break
        }
      }
      if (tooClose) continue

      // Weighted random: 50% tree, 15% rock, 15% bush, 12% building, 8% flower patch
      const roll = Math.random()
      let decor: THREE.Object3D
      if (roll < 0.50) {
        decor = this.createRandomTree()
      } else if (roll < 0.65) {
        decor = this.createRock()
      } else if (roll < 0.80) {
        decor = this.createBush()
      } else if (roll < 0.92) {
        decor = this.createBuilding()
      } else {
        decor = this.createFlowerPatch()
      }
      decor.position.set(x, height, z)
      decor.rotation.y = Math.random() * Math.PI * 2
      decorations.push(decor)
    }

    return decorations
  }

  // ---- Tree variety ----

  private createRandomTree(): THREE.Group {
    const kind = Math.random()
    if (kind < 0.35) return this.createPineTree()
    if (kind < 0.65) return this.createBroadleafTree()
    if (kind < 0.85) return this.createWillowTree()
    return this.createBareTree()
  }

  /** Classic pine: layered cone foliage */
  private createPineTree(): THREE.Group {
    const tree = new THREE.Group()
    const trunkGeom = new THREE.CylinderGeometry(0.2, 0.25, 1, 6)
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8B5A2B, roughness: 0.9 })
    const trunk = new THREE.Mesh(trunkGeom, trunkMat)
    trunk.position.y = 0.5
    trunk.castShadow = true

    const foliageGeom = new THREE.CylinderGeometry(0, 1.2, 2.5, 8)
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x2E8B57, roughness: 0.8 })
    const foliage = new THREE.Mesh(foliageGeom, foliageMat)
    foliage.position.y = 2
    foliage.castShadow = true

    tree.add(trunk)
    tree.add(foliage)
    this.addShadow(tree, 1.2)
    return tree
  }

  /** Broadleaf: trunk + clustered sphere foliage puffs */
  private createBroadleafTree(): THREE.Group {
    const tree = new THREE.Group()
    const h = 1.5 + Math.random() * 1.5 // trunk height
    const trunkGeom = new THREE.CylinderGeometry(0.12, 0.2, h, 5)
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6a4a32, roughness: 0.9 })
    const trunk = new THREE.Mesh(trunkGeom, trunkMat)
    trunk.position.y = h / 2
    trunk.castShadow = true
    tree.add(trunk)

    // 3-5 foliage spheres clustered on top
    const greenBase = 0x3a7a3a + Math.floor(Math.random() * 0x001010)
    const puffCount = 3 + Math.floor(Math.random() * 3)
    for (let i = 0; i < puffCount; i++) {
      const r = 0.5 + Math.random() * 0.6
      const geom = new THREE.SphereGeometry(r, 6, 5)
      const mat = new THREE.MeshStandardMaterial({
        color: greenBase + Math.floor(Math.random() * 0x000808),
        roughness: 0.85,
        flatShading: true,
      })
      const puff = new THREE.Mesh(geom, mat)
      puff.position.set(
        (Math.random() - 0.5) * 0.8,
        h + (Math.random() - 0.3) * 0.6,
        (Math.random() - 0.5) * 0.8
      )
      puff.castShadow = true
      tree.add(puff)
    }
    this.addShadow(tree, 1.0)
    return tree
  }

  /** Willow: short trunk + drooping cone strands */
  private createWillowTree(): THREE.Group {
    const tree = new THREE.Group()
    const trunkGeom = new THREE.CylinderGeometry(0.15, 0.22, 1.8, 5)
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.9 })
    const trunk = new THREE.Mesh(trunkGeom, trunkMat)
    trunk.position.y = 0.9
    trunk.castShadow = true
    tree.add(trunk)

    // Drooping foliage: inverted cone with wider base
    const foliageGeom = new THREE.ConeGeometry(1.4, 2.2, 7)
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x5a8a4a, roughness: 0.85, flatShading: true })
    const foliage = new THREE.Mesh(foliageGeom, foliageMat)
    foliage.position.y = 2.8
    foliage.castShadow = true
    tree.add(foliage)
    this.addShadow(tree, 1.4)
    return tree
  }

  /** Bare tree: trunk + branch cylinders, no leaves */
  private createBareTree(): THREE.Group {
    const tree = new THREE.Group()
    const h = 1.8 + Math.random() * 1.2
    const branchMat = new THREE.MeshStandardMaterial({ color: 0x4a3c30, roughness: 0.95 })

    const trunkGeom = new THREE.CylinderGeometry(0.1, 0.18, h, 5)
    const trunk = new THREE.Mesh(trunkGeom, branchMat)
    trunk.position.y = h / 2
    trunk.castShadow = true
    tree.add(trunk)

    // 3-5 branches radiating from the top
    const branchCount = 3 + Math.floor(Math.random() * 3)
    for (let i = 0; i < branchCount; i++) {
      const len = 0.5 + Math.random() * 0.8
      const geom = new THREE.CylinderGeometry(0.03, 0.05, len, 4)
      const branch = new THREE.Mesh(geom, branchMat)
      const angle = (i / branchCount) * Math.PI * 2 + Math.random() * 0.5
      branch.position.set(
        Math.cos(angle) * len * 0.4,
        h * 0.8 + Math.random() * h * 0.2,
        Math.sin(angle) * len * 0.4
      )
      branch.rotation.set(
        (Math.random() - 0.5) * 0.8,
        0,
        (Math.random() - 0.5) * 0.8 + 0.4
      )
      tree.add(branch)
    }
    this.addShadow(tree, 0.6)
    return tree
  }

  // ---- Other decorations ----

  private createRock(): THREE.Mesh {
    const size = 0.5 + Math.random() * 0.5
    const geom = new THREE.DodecahedronGeometry(size, 0)
    const mat = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.8, flatShading: true })
    const rock = new THREE.Mesh(geom, mat)
    rock.castShadow = true
    this.addShadow(rock, size * 0.6)
    return rock
  }

  /** Low bush: squashed sphere */
  private createBush(): THREE.Mesh {
    const r = 0.3 + Math.random() * 0.4
    const geom = new THREE.SphereGeometry(r, 5, 4)
    const greenShade = 0x2a6a2a + Math.floor(Math.random() * 0x001508)
    const mat = new THREE.MeshStandardMaterial({ color: greenShade, roughness: 0.9, flatShading: true })
    const bush = new THREE.Mesh(geom, mat)
    bush.scale.y = 0.6
    bush.castShadow = true
    this.addShadow(bush, r * 0.7)
    return bush
  }

  /** Small flower patch: cluster of tiny colored spheres */
  private createFlowerPatch(): THREE.Group {
    const patch = new THREE.Group()
    const colors = [0xff6a6a, 0xffcc44, 0xff8aff, 0xffffff, 0xffaa33]
    const count = 3 + Math.floor(Math.random() * 4)
    for (let i = 0; i < count; i++) {
      const r = 0.04 + Math.random() * 0.04
      const geom = new THREE.SphereGeometry(r, 4, 3)
      const mat = new THREE.MeshStandardMaterial({
        color: colors[Math.floor(Math.random() * colors.length)],
        roughness: 0.6,
      })
      const flower = new THREE.Mesh(geom, mat)
      flower.position.set(
        (Math.random() - 0.5) * 0.6,
        0.05 + Math.random() * 0.1,
        (Math.random() - 0.5) * 0.6
      )
      patch.add(flower)
    }
    return patch
  }

  /** Small building: farmhouse or shed */
  private createBuilding(): THREE.Group {
    const bldg = new THREE.Group()
    const w = 2 + Math.random() * 2
    const d = 1.5 + Math.random() * 1.5
    const h = 1.2 + Math.random() * 0.8

    // Walls
    const wallColors = [0xb8a088, 0xa89878, 0xc0b090, 0x988868]
    const wallGeom = new THREE.BoxGeometry(w, h, d)
    const wallMat = new THREE.MeshStandardMaterial({
      color: wallColors[Math.floor(Math.random() * wallColors.length)],
      roughness: 0.85,
    })
    const walls = new THREE.Mesh(wallGeom, wallMat)
    walls.position.y = h / 2
    walls.castShadow = true
    bldg.add(walls)

    // Roof (triangular prism)
    const roofH = h * 0.6
    const roofGeom = new THREE.CylinderGeometry(0, Math.max(w, d) * 0.75, roofH, 4)
    const roofColors = [0x8a4a3a, 0x6a5a4a, 0x7a3a2a]
    const roofMat = new THREE.MeshStandardMaterial({
      color: roofColors[Math.floor(Math.random() * roofColors.length)],
      roughness: 0.8,
      flatShading: true,
    })
    const roof = new THREE.Mesh(roofGeom, roofMat)
    roof.position.y = h + roofH / 2
    roof.rotation.y = Math.PI / 4
    roof.castShadow = true
    bldg.add(roof)

    // Door (dark rectangle on one face)
    const doorGeom = new THREE.BoxGeometry(0.4, 0.7, 0.02)
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.9 })
    const door = new THREE.Mesh(doorGeom, doorMat)
    door.position.set(0, 0.35, d / 2 + 0.01)
    bldg.add(door)

    // Window (small bright rectangle)
    const winGeom = new THREE.BoxGeometry(0.3, 0.3, 0.02)
    const winMat = new THREE.MeshStandardMaterial({ color: 0xffeeaa, roughness: 0.3, emissive: 0xffeeaa, emissiveIntensity: 0.2 })
    const win = new THREE.Mesh(winGeom, winMat)
    win.position.set(w * 0.25, h * 0.55, d / 2 + 0.01)
    bldg.add(win)

    this.addShadow(bldg, Math.max(w, d) * 0.6)
    return bldg
  }

  private computeVertexColor(
    height: number,
    slope: number,
    cols: BiomeColors,
    params: HeightParams
  ): { r: number; g: number; b: number } {
    const maxH = params.baseHeight + params.amplitude * 1.5
    const snowLine = maxH * 0.75

    // Snow on high peaks
    if (height > snowLine) {
      const t = Math.min(1, (height - snowLine) / (maxH * 0.2))
      return this.lerpColor(cols.snow, cols.rock, t)
    }

    // Rock on steep slopes
    if (slope > 3) {
      const t = Math.min(1, (slope - 3) / 4)
      return this.lerpColor(cols.rock, cols.groundDark, 1 - t)
    }

    // Sand near water (low height)
    if (height < params.baseHeight - 0.5) {
      const t = Math.min(1, (params.baseHeight - 0.5 - height) / 2)
      return this.lerpColor(cols.sand, cols.groundDark, t)
    }

    // Default ground
    const t = Math.max(0, Math.min(1, (height - params.baseHeight) / params.amplitude))
    return this.lerpColor(cols.groundDark, cols.ground, t)
  }

  private lerpColor(a: number, b: number, t: number): { r: number; g: number; b: number } {
    const ca = new THREE.Color(a)
    const cb = new THREE.Color(b)
    ca.lerp(cb, t)
    return { r: ca.r, g: ca.g, b: ca.b }
  }

  private clearChunks() {
    for (const chunk of this.chunks.values()) {
      this.removeChunk(chunk)
    }
    this.chunks.clear()
  }

  dispose() {
    this.clearChunks()
    this.material.dispose()
    this.shadowDisc.geom.dispose()
    this.shadowDisc.mat.dispose()
  }
}
