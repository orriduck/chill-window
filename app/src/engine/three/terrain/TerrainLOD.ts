import * as THREE from 'three'
import { TerrainGen } from './TerrainGen'
import type { BiomeType, BiomeConfig } from './Biome'
import { getBiomeConfig } from './Biome'

interface Chunk {
  mesh: THREE.Mesh
  x: number
  z: number
  lod: number
}

const CHUNK_SIZE = 256
const MAX_CHUNKS_Z = 5
const MAX_CHUNKS_X = 3
const UPDATE_INTERVAL = 10 // frames

export class TerrainLOD {
  private scene: THREE.Scene
  private terrainGen = new TerrainGen()
  private chunks = new Map<string, Chunk>()
  private biome: BiomeType
  private biomeConfig: BiomeConfig
  private frameCount = 0
  private material: THREE.MeshStandardMaterial

  constructor(scene: THREE.Scene, biome: BiomeType = 'field') {
    this.scene = scene
    this.biome = biome
    this.biomeConfig = getBiomeConfig(biome)

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.0,
      flatShading: true,
    })
  }

  setBiome(biome: BiomeType) {
    if (this.biome === biome) return
    this.biome = biome
    this.biomeConfig = getBiomeConfig(biome)
    this.clearChunks()
  }

  update(cameraPos: THREE.Vector3) {
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
        this.scene.remove(chunk.mesh)
        chunk.mesh.geometry.dispose()
        this.chunks.delete(key)
      }
    }
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
    const params = this.biomeConfig.heightParams
    const cols = this.biomeConfig.colors

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
    this.chunks.set(`${cx},${cz}`, { mesh, x: cx, z: cz, lod: resolution })
  }

  private computeVertexColor(
    height: number,
    slope: number,
    cols: BiomeConfig['colors'],
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
      this.scene.remove(chunk.mesh)
      chunk.mesh.geometry.dispose()
    }
    this.chunks.clear()
  }

  dispose() {
    this.clearChunks()
    this.material.dispose()
  }
}
