import * as THREE from 'three'
import { TerrainGen } from './TerrainGen'
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
const MAX_CHUNKS_Z = 4
const MAX_CHUNKS_X = 3
const UPDATE_INTERVAL = 10 // frames
const SEGMENT_LENGTH = 2000 // travel distance per biome
const BLEND_LENGTH = 500 // transition distance between biomes
const BIOME_ORDER: BiomeType[] = ['field', 'forest', 'mountain', 'river', 'town']

export class TerrainLOD {
  private scene: THREE.Scene
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

  constructor(scene: THREE.Scene, biome: BiomeType = 'field') {
    this.scene = scene
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

    for (let dz = -1; dz < MAX_CHUNKS_Z; dz++) {
      for (let dx = -Math.floor(MAX_CHUNKS_X / 2); dx <= Math.floor(MAX_CHUNKS_X / 2); dx++) {
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
    this.scene.remove(chunk.mesh)
    chunk.mesh.geometry.dispose()

    for (const decor of chunk.decorations) {
      this.scene.remove(decor)
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

    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i]
      const z = positions[i + 2]
      const h = this.terrainGen.getHeight(x, z, params)
      positions[i + 1] = h

      const slope = this.terrainGen.getSlope(x, z, params)
      const color = this.computeVertexColor(h, slope, cols, params)
      colors[i] = color.r
      colors[i + 1] = color.g
      colors[i + 2] = color.b
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.computeVertexNormals()

    const mesh = new THREE.Mesh(geometry, this.material)
    mesh.position.set(worldX + CHUNK_SIZE / 2, 0, worldZ + CHUNK_SIZE / 2)
    mesh.castShadow = true
    mesh.receiveShadow = true

    this.scene.add(mesh)
    // Distant (low-res) chunks get fewer decorations
    const densityScale = resolution === 64 ? 1 : resolution === 32 ? 0.5 : 0.25
    const decorations = this.createDecorations(worldX, worldZ, params, densityScale)
    for (const decor of decorations) {
      this.scene.add(decor)
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

      const decor = Math.random() > 0.3 ? this.createTree() : this.createRock()
      decor.position.set(x, height, z)
      decor.rotation.y = Math.random() * Math.PI * 2
      decorations.push(decor)
    }

    return decorations
  }

  private createTree(): THREE.Group {
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
    return tree
  }

  private createRock(): THREE.Mesh {
    const size = 0.5 + Math.random() * 0.5
    const geom = new THREE.DodecahedronGeometry(size, 0)
    const mat = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.8, flatShading: true })
    const rock = new THREE.Mesh(geom, mat)
    rock.castShadow = true
    return rock
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
  }
}
