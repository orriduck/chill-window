import * as THREE from 'three'
import {
  TerrainGen, TRACK_FLAT_HALF,
  riverCenterX, RIVER_BANK, RIVER_HALF_WIDTH,
  roadCenterX, ROAD_HALF_WIDTH, ROAD_VERGE,
} from './TerrainGen'
import type { BiomeType, BiomeColors, HeightParams } from './Biome'
import { getBiomeConfig } from './Biome'
import { createHouse, createTownCluster } from './TownGenerator'
import {
  groundGrassTex, groundRockBumpTex,
  grassSpriteTex, bushSpriteTex,
  treeNearTex, treeNearBTex, treeFarTex, treeFarBTex,
  applyAtlasUV,
} from '../textures'

interface Chunk {
  mesh: THREE.Mesh
  decorations: THREE.Object3D[]
  grass?: THREE.InstancedMesh[]
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

  // ---- Shared vegetation sprite resources (one per TerrainLOD instance) ----
  private grassGeoms: THREE.BufferGeometry[] = []   // 4 atlas variants (2x2)
  private grassMat!: THREE.MeshStandardMaterial
  private bushGeoms: THREE.BufferGeometry[] = []    // 4 atlas variants, crossed
  private bushMat!: THREE.MeshStandardMaterial
  private treeGeomsNear: THREE.BufferGeometry[] = [] // 8 variants, crossed
  private treeGeomsFar: THREE.BufferGeometry[] = []  // 8 variants, crossed
  private treeMatNear!: THREE.MeshStandardMaterial
  private treeMatNearB!: THREE.MeshStandardMaterial
  private treeMatFar!: THREE.MeshStandardMaterial
  private treeMatFarB!: THREE.MeshStandardMaterial

  constructor(scene: THREE.Object3D, biome: BiomeType = 'field') {
    this.parent = scene
    this.currentBiome = biome
    this.nextBiome = this.pickNextBiome(biome)
    this.segmentStartZ = 0

    const config = getBiomeConfig(biome)
    this.activeParams = { ...config.heightParams }
    this.activeColors = { ...config.colors }
    this.activeDecorDensity = config.decorDensity

    // Ground: real grass photo texture + bump, tinted by vertex colors
    groundGrassTex.wrapS = THREE.RepeatWrapping
    groundGrassTex.wrapT = THREE.RepeatWrapping
    groundGrassTex.repeat.set(CHUNK_SIZE / 10, CHUNK_SIZE / 10)
    groundRockBumpTex.wrapS = THREE.RepeatWrapping
    groundRockBumpTex.wrapT = THREE.RepeatWrapping
    groundRockBumpTex.repeat.set(CHUNK_SIZE / 10, CHUNK_SIZE / 10)
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: groundGrassTex,
      bumpMap: groundRockBumpTex,
      bumpScale: 0.35,
      roughness: 0.95,
      metalness: 0.0,
      flatShading: false,
    })

    // Grass sprites: single quads, one geometry per atlas variant (UV-baked)
    this.grassMat = new THREE.MeshStandardMaterial({
      map: grassSpriteTex,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 1.0,
      metalness: 0,
    })
    for (let v = 0; v < 4; v++) {
      const g = new THREE.PlaneGeometry(0.75, 0.6)
      g.translate(0, 0.28, 0)
      applyAtlasUV(g, v % 2, Math.floor(v / 2), 2, 2)
      this.grassGeoms.push(g)
    }

    // Bush sprites: crossed quads, one geometry per atlas variant
    this.bushMat = new THREE.MeshStandardMaterial({
      map: bushSpriteTex,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 1.0,
      metalness: 0,
    })
    for (let v = 0; v < 4; v++) {
      this.bushGeoms.push(this.makeCrossedSprite(1.6, 0.8, v % 2, Math.floor(v / 2), 2, 2))
    }

    // Tree sprites: crossed quads, near + far atlases (4x1 each, two sheets)
    const treeMatOpts: THREE.MeshStandardMaterialParameters = {
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 1.0,
      metalness: 0,
    }
    this.treeMatNear = new THREE.MeshStandardMaterial({ ...treeMatOpts, map: treeNearTex })
    this.treeMatNearB = new THREE.MeshStandardMaterial({ ...treeMatOpts, map: treeNearBTex })
    this.treeMatFar = new THREE.MeshStandardMaterial({ ...treeMatOpts, map: treeFarTex })
    this.treeMatFarB = new THREE.MeshStandardMaterial({ ...treeMatOpts, map: treeFarBTex })
    for (let v = 0; v < 8; v++) {
      this.treeGeomsNear.push(this.makeCrossedSprite(2.4, 4.8, v % 4, 0, 4, 1))
      this.treeGeomsFar.push(this.makeCrossedSprite(2.4, 4.8, v % 4, 0, 4, 1))
    }
  }

  /** Two quads crossed at 90°, merged into one geometry, UV-windowed into an
   *  atlas cell. Base of the sprite sits at local y=0. */
  private makeCrossedSprite(
    w: number,
    h: number,
    col: number,
    row: number,
    cols: number,
    rows: number,
  ): THREE.BufferGeometry {
    const p1 = new THREE.PlaneGeometry(w, h)
    p1.translate(0, h / 2, 0)
    const p2 = p1.clone()
    p2.rotateY(Math.PI / 2)
    const a = p1.toNonIndexed()
    const b = p2.toNonIndexed()
    const merged = new THREE.BufferGeometry()
    for (const name of ['position', 'normal', 'uv'] as const) {
      const aa = a.attributes[name].array as Float32Array
      const bb = b.attributes[name].array as Float32Array
      const itemSize = a.attributes[name].itemSize
      const out = new Float32Array(aa.length + bb.length)
      out.set(aa, 0)
      out.set(bb, aa.length)
      merged.setAttribute(name, new THREE.BufferAttribute(out, itemSize))
    }
    applyAtlasUV(merged, col, row, cols, rows)
    p1.dispose()
    p2.dispose()
    a.dispose()
    b.dispose()
    return merged
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

    if (chunk.grass) {
      for (const g of chunk.grass) this.parent.remove(g)
      // Shared geometries/material managed by TerrainLOD, not per-chunk.
      // GPU instance-data buffers are small; JS GC reclaims them when
      // the InstancedMesh wrappers are collected.
    }

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

  /** Fill per-variant InstancedMeshes with grass sprite tufts for a chunk,
   *  skipping the rail corridor, roads, rivers, and steep slopes.
   *  Uses deterministic per-cell hash instead of Math.random() so chunk
   *  recreation is stable and allocation-free beyond the matrix buffers. */
  private populateGrass(
    worldX: number,
    worldZ: number,
    params: HeightParams,
    densityScale: number,
  ): THREE.InstancedMesh[] {
    // Dense coverage: single-quad sprites are cheap enough for high density
    const spacing = densityScale >= 1 ? 2.3 : densityScale >= 0.5 ? 3.6 : 6.0
    const cols = Math.floor(CHUNK_SIZE / spacing)
    const rows = Math.floor(CHUNK_SIZE / spacing)
    if (cols === 0 || rows === 0) return []

    // Collect matrix elements into flat arrays per variant (no Matrix4 allocs)
    const variantData: number[][] = [[], [], [], []]
    const dummy = new THREE.Object3D()
    const riverStrength = params.river ?? 0
    // Slope sampling is the hot path (multiple noise evals per cell) —
    // only bother for near chunks where steep-bank grass is visible
    const checkSlope = densityScale >= 1

    for (let ci = 0; ci < cols; ci++) {
      for (let ri = 0; ri < rows; ri++) {
        const jx = (hash2(ci * 997 + ri * 3, worldZ * 0.001) - 0.5) * spacing * 0.6
        const jz = (hash2(ci * 13 + ri * 733, worldX * 0.001) - 0.5) * spacing * 0.6
        const x = worldX + ci * spacing + spacing / 2 + jx
        const z = worldZ + ri * spacing + spacing / 2 + jz

        if (Math.abs(x) < TRACK_FLAT_HALF + 5) continue
        if (Math.abs(x - roadCenterX(z)) < ROAD_VERGE + 1) continue
        if (riverStrength > 0.2 && Math.abs(x - riverCenterX(z)) < RIVER_BANK + 1.5) continue

        const h = this.terrainGen.getHeight(x, z, params)
        if (checkSlope && this.terrainGen.getSlope(x, z, params) > 1.3) continue

        const rot = hash2(ci * 31 + ri * 17, worldZ) * Math.PI * 2
        const scale = 0.85 + hash2(ci * 7 + ri * 11, worldX) * 1.15
        const variant = Math.floor(hash2(ci * 5 + ri * 41, worldX + worldZ) * 4)

        dummy.position.set(x, h + 0.03, z)
        dummy.rotation.set(0, rot, 0)
        dummy.scale.setScalar(scale)
        dummy.updateMatrix()
        const e = dummy.matrix.elements
        const arr = variantData[variant]
        for (let k = 0; k < 16; k++) arr.push(e[k])
      }
    }

    const meshes: THREE.InstancedMesh[] = []
    for (let v = 0; v < 4; v++) {
      const data = variantData[v]
      const count = data.length / 16
      if (count === 0) continue
      const mesh = new THREE.InstancedMesh(this.grassGeoms[v], this.grassMat, count)
      mesh.castShadow = false // alpha-tested grass casting shadows = noise + cost
      mesh.receiveShadow = false // and sampling shadows per-fragment is the real killer
      mesh.frustumCulled = false
      mesh.instanceMatrix.array.set(data)
      mesh.instanceMatrix.needsUpdate = true
      meshes.push(mesh)
    }
    return meshes
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
    // Dense grass sprites covering all green terrain
    const grass = this.populateGrass(worldX, worldZ, params, densityScale)
    for (const g of grass) this.parent.add(g)
    this.chunks.set(`${cx},${cz}`, { mesh, decorations, grass: grass.length > 0 ? grass : undefined, x: cx, z: cz, lod: resolution })
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
        decor = this.createTreeBillboard(densityScale)
      } else if (roll < 0.63) {
        decor = this.createRock()
      } else if (roll < 0.77) {
        decor = this.createBushBillboard()
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

  // ---- Vegetation billboards ----

  /** Tree billboard: crossed quads textured with a pre-rendered tree sprite.
   *  Near chunks use the detailed sheet, far chunks the silhouette sheet. */
  private createTreeBillboard(densityScale: number): THREE.Group {
    const tree = new THREE.Group()
    const near = densityScale >= 0.5
    const variant = Math.floor(Math.random() * 8)
    const geom = near ? this.treeGeomsNear[variant] : this.treeGeomsFar[variant]
    const mat = near
      ? (variant < 4 ? this.treeMatNear : this.treeMatNearB)
      : (variant < 4 ? this.treeMatFar : this.treeMatFarB)
    const sprite = new THREE.Mesh(geom, mat)
    sprite.castShadow = near // far sprites skip the alpha-tested shadow pass
    tree.add(sprite)
    this.addShadow(tree, 1.2)
    return tree
  }

  /** Bush billboard: crossed quads with a pre-rendered bush sprite. */
  private createBushBillboard(): THREE.Group {
    const bush = new THREE.Group()
    const variant = Math.floor(Math.random() * 4)
    const sprite = new THREE.Mesh(this.bushGeoms[variant], this.bushMat)
    sprite.castShadow = true
    bush.add(sprite)
    this.addShadow(bush, 0.8)
    return bush
  }

  private createRock(): THREE.Mesh {
    const size = 0.5 + Math.random() * 0.5
    const geom = new THREE.DodecahedronGeometry(size, 0)
    const mat = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.8, flatShading: true })
    const rock = new THREE.Mesh(geom, mat)
    rock.castShadow = true
    this.addShadow(rock, size * 0.6)
    return rock
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

    // Default ground: brighten toward white so the grass photo texture
    // dominates; the biome hue only tints (field warm, forest cool…).
    const t = Math.max(0, Math.min(1, (height - params.baseHeight) / params.amplitude))
    const groundTint = this.lerpColor(cols.groundDark, cols.ground, t)
    const tint = this.lerpColor(this.rgbToHexNum(groundTint), 0xffffff, 0.55)
    return { ...tint, isGround: true }
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
    for (const g of this.grassGeoms) g.dispose()
    this.grassMat.dispose()
    for (const g of this.bushGeoms) g.dispose()
    this.bushMat.dispose()
    for (const g of this.treeGeomsNear) g.dispose()
    for (const g of this.treeGeomsFar) g.dispose()
    this.treeMatNear.dispose()
    this.treeMatNearB.dispose()
    this.treeMatFar.dispose()
    this.treeMatFarB.dispose()
    // Note: shared textures in ../textures are app-lifetime resources,
    // disposed only on full shutdown via disposeSharedTextures().
  }
}
