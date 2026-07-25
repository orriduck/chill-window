import * as THREE from 'three'
import {
  TerrainGen, TRACK_FLAT_HALF,
  riverCenterX, RIVER_BANK, RIVER_HALF_WIDTH,
  roadCenterX, ROAD_HALF_WIDTH, ROAD_VERGE,
} from './TerrainGen'
import type { BiomeType, BiomeColors, HeightParams } from './Biome'
import { getBiomeConfig } from './Biome'
import { createHouse, createTownCluster } from './TownGenerator'

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
// Slowroad-style mottled meadow tones: dry golden straw vs deep olive
const MEADOW_GOLD = 0xc2b26a
const MEADOW_OLIVE = 0x3d6631
// Country road: packed dirt with darker wheel ruts (asphalt in town)
const ROAD_DIRT = 0x9a8258
const ROAD_RUT = 0x7a6642
const ROAD_ASPHALT = 0x4e4a44

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
      map: this.makeGroundDetailTexture(),
      roughness: 0.9,
      metalness: 0.0,
      // Smooth shading + detail texture: rolling turf instead of low-poly facets
      flatShading: false,
    })
  }

  /** Fine turf/soil grain tiled over the terrain, multiplied with vertex
   *  colors. Near-white average so it only adds texture, not brightness. */
  private makeGroundDetailTexture(): THREE.Texture {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#f2f2f2'
    ctx.fillRect(0, 0, size, size)
    // Short turf strokes: tiny darker/lighter dashes at random angles
    for (let i = 0; i < 2600; i++) {
      const v = 205 + Math.floor(Math.random() * 50)
      ctx.strokeStyle = `rgba(${v - 30},${v},${v - 45},0.55)`
      ctx.lineWidth = 1
      const x = Math.random() * size
      const y = Math.random() * size
      const a = Math.random() * Math.PI
      const len = 1 + Math.random() * 2.2
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len)
      ctx.stroke()
    }
    // Sparse darker soil freckles
    for (let i = 0; i < 260; i++) {
      const v = 165 + Math.floor(Math.random() * 40)
      ctx.fillStyle = `rgba(${v},${v},${v - 15},0.5)`
      ctx.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5)
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    // PlaneGeometry UVs span 0..1 per chunk; tile every ~5 world units
    tex.repeat.set(CHUNK_SIZE / 5, CHUNK_SIZE / 5)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    return tex
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

  /** 0..1 — current river carve strength (biome-blended). */
  get riverStrength(): number {
    return this.activeParams.river ?? 0
  }

  private rgbToHex(c: { r: number; g: number; b: number }): number {
    return (
      (Math.round(c.r * 255) << 16) |
      (Math.round(c.g * 255) << 8) |
      Math.round(c.b * 255)
    )
  }

  /** Alias of rgbToHex for readability when chaining lerpColor results. */
  private rgbToHexNum(c: { r: number; g: number; b: number }): number {
    return this.rgbToHex(c)
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
      river: THREE.MathUtils.lerp(a.river ?? 0, b.river ?? 0, t),
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
        const disposeMat = (m: THREE.Material) => {
          // Free canvas textures attached to the material (window grids etc.)
          const std = m as THREE.MeshStandardMaterial
          if (std.map) std.map.dispose()
          if (std.emissiveMap) std.emissiveMap.dispose()
          m.dispose()
        }
        if (Array.isArray(obj.material)) {
          obj.material.forEach(disposeMat)
        } else {
          disposeMat(obj.material)
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

      // Ballast coloring: gravel speckle only on the rail bed itself (|x|<6).
      // Beyond that the verge is meadow — grass comes right up to the track
      // like the slowroad reference, not a wide bare gravel strip.
      const dist = Math.abs(x)
      if (dist < 6) {
        const t = THREE.MathUtils.smoothstep((dist - 4) / 4, 0, 1)
        const gravelTone = hash2(x, z) > 0.5 ? BALLAST_LIGHT : BALLAST_DARK
        color = { ...this.lerpColor(gravelTone, this.rgbToHex(color), t), isGround: false }
      } else if (color.isGround) {
        // Slowroad-style mottled meadow: low-frequency golden-straw vs
        // deep-olive patches, plus a fine per-vertex grain so the grass
        // reads as dense short turf instead of a flat gradient.
        const patch = this.terrainGen.getMottle(x, z)
        const patchStrength = Math.min(1, Math.abs(patch - 0.5) * 2) * 0.55
        const patchTone = patch > 0.5 ? MEADOW_GOLD : MEADOW_OLIVE
        color = { ...this.lerpColor(this.rgbToHex(color), patchTone, patchStrength), isGround: true }
        const grain = 0.93 + hash2(x * 3.1, z * 3.1) * 0.14
        color.r = Math.min(1, color.r * grain)
        color.g = Math.min(1, color.g * grain)
        color.b = Math.min(1, color.b * grain)
      }

      // Country road: packed dirt lane with darker wheel ruts, grass verge
      // blend on the edges. Asphalt when passing through town.
      const roadD = Math.abs(x - roadCenterX(z))
      if (roadD < ROAD_VERGE && dist >= 6) {
        const inTown = this.currentBiome === 'town'
        const base = inTown ? ROAD_ASPHALT : ROAD_DIRT
        const speck = 0.9 + hash2(x * 7.3, z * 7.3) * 0.2
        let roadTone = base
        if (!inTown && Math.abs(roadD - 0.9) < 0.28) roadTone = ROAD_RUT
        const edge = THREE.MathUtils.smoothstep((roadD - ROAD_HALF_WIDTH) / (ROAD_VERGE - ROAD_HALF_WIDTH), 0, 1)
        const mixed = this.lerpColor(roadTone, this.rgbToHex(color), edge)
        color = { r: Math.min(1, mixed.r * speck), g: Math.min(1, mixed.g * speck), b: Math.min(1, mixed.b * speck), isGround: false }
      }

      // River banks: sandy shore hugging the channel when the river is active
      const riverStrength = params.river ?? 0
      if (riverStrength > 0.05) {
        const riverD = Math.abs(x - riverCenterX(z))
        if (riverD < RIVER_BANK && riverD > RIVER_HALF_WIDTH * 0.7) {
          const t = THREE.MathUtils.smoothstep((riverD - RIVER_HALF_WIDTH) / (RIVER_BANK - RIVER_HALF_WIDTH), 0, 1)
          const sandy = this.lerpColor(cols.sand, this.rgbToHex(color), t)
          color = { ...sandy, isGround: false }
        }
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
    const riverStrength = params.river ?? 0

    // Town biome: a coherent settlement instead of scattered farmhouses —
    // one cluster per chunk, centred away from the road and rail corridor
    if (this.currentBiome === 'town' && densityScale >= 0.5) {
      const cx = Math.max(worldX + 40 + Math.random() * 60, 34)
      const cz = worldZ + CHUNK_SIZE / 2
      const town = createTownCluster(cx, cz, (x, z) => this.terrainGen.getHeight(x, z, params))
      decorations.push(town)
      // A few trees still scatter around the town edge
    }

    const attempts = Math.floor(this.activeDecorDensity * 80 * densityScale)

    for (let i = 0; i < attempts; i++) {
      const x = worldX + Math.random() * CHUNK_SIZE
      const z = worldZ + Math.random() * CHUNK_SIZE

      // Keep the rail corridor clear of trees/rocks
      if (Math.abs(x) < TRACK_FLAT_HALF + 4) continue
      // Keep the country road clear
      if (Math.abs(x - roadCenterX(z)) < ROAD_VERGE + 1) continue
      // Keep the river channel clear
      if (riverStrength > 0.2 && Math.abs(x - riverCenterX(z)) < RIVER_BANK + 2) continue

      const height = this.terrainGen.getHeight(x, z, params)
      const slope = this.terrainGen.getSlope(x, z, params)

      // Steep ground: no trees or buildings, but rock outcrops grip the slope
      if (slope >= 2) {
        if (slope < 4.5 && Math.random() < 0.45) {
          const outcrop = this.createRockOutcrop()
          outcrop.position.set(x, height - 0.35, z)
          outcrop.rotation.y = Math.random() * Math.PI * 2
          const s = 0.9 + Math.random() * 1.6
          outcrop.scale.setScalar(s)
          decorations.push(outcrop)
        }
        continue
      }

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

      // Weighted random: 50% tree, 13% rock, 14% bush, 12% building,
      // 7% flower patch, 4% rock slab cluster
      const roll = Math.random()
      let decor: THREE.Object3D
      if (roll < 0.50) {
        decor = this.createRandomTree()
      } else if (roll < 0.63) {
        decor = this.createRock()
      } else if (roll < 0.77) {
        decor = this.createBush()
      } else if (roll < 0.89) {
        decor = createHouse()
      } else if (roll < 0.96) {
        decor = this.createFlowerPatch()
      } else {
        decor = this.createRockOutcrop()
      }
      decor.position.set(x, height - 0.12, z) // sink slightly — roots grip the slope
      decor.rotation.y = Math.random() * Math.PI * 2
      const s = 0.8 + Math.random() * 0.7
      decor.scale.setScalar(s)
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

  /** Layered pine: 2-3 stacked cones, per-tree hue jitter — reads as a real
   *  conifer silhouette instead of a single party hat. */
  private createPineTree(): THREE.Group {
    const tree = new THREE.Group()
    const trunkGeom = new THREE.CylinderGeometry(0.18, 0.26, 1, 6)
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.9 })
    const trunk = new THREE.Mesh(trunkGeom, trunkMat)
    trunk.position.y = 0.5
    trunk.castShadow = true
    tree.add(trunk)

    // Hue jitter around a deep spruce green
    const hue = 0.33 + Math.random() * 0.05
    const sat = 0.4 + Math.random() * 0.2
    const layers = 2 + (Math.random() < 0.5 ? 1 : 0)
    const baseRadius = 1.1 + Math.random() * 0.4
    for (let i = 0; i < layers; i++) {
      const f = i / layers // 0 bottom .. ~1 top
      const r = baseRadius * (1 - f * 0.55)
      const h = 1.6 - f * 0.3
      const geom = new THREE.ConeGeometry(r, h, 7)
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(hue, sat, 0.28 + f * 0.07),
        roughness: 0.85,
        flatShading: true,
      })
      const cone = new THREE.Mesh(geom, mat)
      cone.position.y = 1.1 + i * 0.85
      cone.castShadow = true
      tree.add(cone)
    }
    this.addShadow(tree, baseRadius)
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
    // White-dominant daisy palette, per the slowroad reference
    const colors = [0xffffff, 0xffffff, 0xf5f0dc, 0xffffff, 0xffe9a8]
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

  /** Rock outcrop: a cluster of angular boulders + flat strata slabs that
   *  breaks up grassy slopes — grey-brown jittered stone, not smooth pebbles. */
  private createRockOutcrop(): THREE.Group {
    const group = new THREE.Group()
    const boulderCount = 2 + Math.floor(Math.random() * 3)
    for (let i = 0; i < boulderCount; i++) {
      const size = 0.5 + Math.random() * 0.9
      const geom = new THREE.DodecahedronGeometry(size, 0)
      const shade = 0.42 + Math.random() * 0.2
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.08 + Math.random() * 0.03, 0.06 + Math.random() * 0.08, shade),
        roughness: 0.95,
        flatShading: true,
      })
      const rock = new THREE.Mesh(geom, mat)
      rock.position.set(
        (Math.random() - 0.5) * 2.2,
        size * (0.3 + Math.random() * 0.3),
        (Math.random() - 0.5) * 2.2
      )
      rock.rotation.set(Math.random() * 0.6, Math.random() * Math.PI, Math.random() * 0.6)
      rock.castShadow = true
      group.add(rock)
    }
    // Strata slab: a thin tilted slab leaning against the boulders
    if (Math.random() < 0.7) {
      const slabMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.09, 0.07, 0.36 + Math.random() * 0.12),
        roughness: 0.9,
        flatShading: true,
      })
      const slab = new THREE.Mesh(new THREE.BoxGeometry(1.6 + Math.random(), 0.22, 0.9 + Math.random() * 0.5), slabMat)
      slab.position.set((Math.random() - 0.5) * 1.5, 0.35 + Math.random() * 0.4, (Math.random() - 0.5) * 1.5)
      slab.rotation.set(0.3 + Math.random() * 0.5, Math.random() * Math.PI, (Math.random() - 0.5) * 0.3)
      slab.castShadow = true
      group.add(slab)
    }
    this.addShadow(group, 1.4)
    return group
  }

  private computeVertexColor(
    height: number,
    slope: number,
    cols: BiomeColors,
    params: HeightParams
  ): { r: number; g: number; b: number; isGround: boolean } {
    const maxH = params.baseHeight + params.amplitude * 1.5
    const snowLine = maxH * 0.75

    // Snow on high peaks
    if (height > snowLine) {
      const t = Math.min(1, (height - snowLine) / (maxH * 0.2))
      return { ...this.lerpColor(cols.snow, cols.rock, t), isGround: false }
    }

    // Rock on steep slopes
    if (slope > 3) {
      const t = Math.min(1, (slope - 3) / 4)
      return { ...this.lerpColor(cols.rock, cols.groundDark, 1 - t), isGround: false }
    }

    // Scree: mid-slope transition band where turf gives way to stone —
    // speckled rock/ground mix so the rock line is ragged, not a clean edge
    if (slope > 1.4) {
      const t = THREE.MathUtils.smoothstep((slope - 1.4) / 1.6, 0, 1) * 0.7
      const ground = this.lerpColor(cols.groundDark, cols.ground, 0.4)
      const scree = this.lerpColor(this.rgbToHexNum(ground), cols.rock, t)
      const grain = 0.88 + Math.random() * 0.24
      return { r: scree.r * grain, g: scree.g * grain, b: scree.b * grain, isGround: false }
    }

    // Sand near water (low height)
    if (height < params.baseHeight - 0.5) {
      const t = Math.min(1, (params.baseHeight - 0.5 - height) / 2)
      return { ...this.lerpColor(cols.sand, cols.groundDark, t), isGround: false }
    }

    // Default ground
    const t = Math.max(0, Math.min(1, (height - params.baseHeight) / params.amplitude))
    return { ...this.lerpColor(cols.groundDark, cols.ground, t), isGround: true }
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
