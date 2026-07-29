import * as THREE from 'three'
import {
  TerrainGen, TRACK_FLAT_HALF,
  waterChannelAt,
  roadCenterX, ROAD_HALF_WIDTH, ROAD_VERGE,
  farBankRoadCenterX,
} from './TerrainGen'
import type { BiomeType, BiomeColors, HeightParams } from './Biome'
import { getBiomeConfig } from './Biome'
import {
  ROUTE_BLEND_LENGTH,
  RIVER_BRIDGE_OFFSET,
  RIVER_VILLAGE_OFFSET,
  ROUTE_SEGMENT_LENGTH,
  routeFeatureForSegment,
  sampleRouteFeature,
} from './RouteFeatures'
import { createRiverVillage, createTownCluster } from './TownGenerator'
import { createSeededRandom, hash01, seedFromGrid, type RandomSource } from '../core/procedural'
import {
  ballastGravelTex, groundGrassTex, groundRockBumpTex, groundRockTex,
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
  cityClusters: number
}

interface TerrainShaderDebug {
  uniforms: {
    terrainDebugView: { value: number }
  }
}

const CHUNK_SIZE = 256
const CHUNKS_BEHIND_Z = 3 // chunks behind the camera along travel (+Z)
const CHUNKS_AHEAD_Z = 5 // prewarmed chunks ahead of the side window
const CHUNKS_VIEW_X = 3 // chunks in the view direction (+X side window)
const UPDATE_INTERVAL = 4 // frames between low-cost streaming jobs
const INITIAL_CHUNKS_PER_TICK = 6
const STREAM_CHUNKS_PER_TICK = 1
const BALLAST_LIGHT = 0x8a8078
const BALLAST_DARK = 0x5f564c
// Slowroad-style mottled meadow tones: dry golden straw vs deep olive
const MEADOW_GOLD = 0xc2b26a
const MEADOW_OLIVE = 0x3d6631
// Country road: packed dirt with darker wheel ruts (asphalt in town)
const ROAD_DIRT = 0x9a8258
const ROAD_RUT = 0x7a6642
const ROAD_ASPHALT = 0x4e4a44

interface BiomeSample {
  type: BiomeType
  next: BiomeType
  segmentIndex: number
  segmentStart: number
  params: HeightParams
  colors: BiomeColors
  decorDensity: number
}

interface DecorationResult {
  decorations: THREE.Object3D[]
  cityClusters: number
}

type SurfaceHeightSampler = (x: number, z: number) => number

export class TerrainLOD {
  private parent: THREE.Object3D
  private terrainGen = new TerrainGen()
  private chunks = new Map<string, Chunk>()
  private frameCount = 0
  private material: THREE.MeshStandardMaterial
  private terrainShader: TerrainShaderDebug | null = null
  private terrainDebugView = 0
  private streamingFrozen = false
  private createdChunks = 0
  private releasedChunks = 0
  private pendingChunks = 0
  private initialWarmup = true

  // Biome transition state
  private currentBiome: BiomeType
  private nextBiome: BiomeType
  private segmentStartZ: number
  private activeParams: HeightParams

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
    const initial = this.getBiomeAt(0)
    this.currentBiome = biome === initial.type ? biome : initial.type
    this.nextBiome = initial.next
    this.segmentStartZ = initial.segmentStart
    this.activeParams = initial.params

    // Ground: vertex colors carry biome tint; the shader selects the local
    // surface material (grass, ballast/dirt, or exposed rock) per vertex.
    groundGrassTex.wrapS = THREE.RepeatWrapping
    groundGrassTex.wrapT = THREE.RepeatWrapping
    groundGrassTex.repeat.set(CHUNK_SIZE / 10, CHUNK_SIZE / 10)
    ballastGravelTex.wrapS = THREE.RepeatWrapping
    ballastGravelTex.wrapT = THREE.RepeatWrapping
    groundRockTex.wrapS = THREE.RepeatWrapping
    groundRockTex.wrapT = THREE.RepeatWrapping
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
    this.material.onBeforeCompile = (shader) => {
      this.terrainShader = shader as unknown as TerrainShaderDebug
      shader.uniforms.terrainGravelMap = { value: ballastGravelTex }
      shader.uniforms.terrainRockMap = { value: groundRockTex }
      shader.uniforms.terrainDebugView = { value: this.terrainDebugView }

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute vec3 terrainBlend;
varying vec3 vTerrainBlend;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vTerrainBlend = terrainBlend;`,
        )

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform sampler2D terrainGravelMap;
uniform sampler2D terrainRockMap;
uniform float terrainDebugView;
varying vec3 vTerrainBlend;`,
        )
        .replace(
          '#include <map_fragment>',
          `#ifdef USE_MAP
vec3 weights = max( vTerrainBlend, vec3( 0.0 ) );
weights /= max( dot( weights, vec3( 1.0 ) ), 0.0001 );
vec3 grassMacro = texture2D( map, vMapUv ).rgb;
vec3 grassDetail = texture2D( map, vMapUv * 3.7 + vec2( 0.17, 0.43 ) ).rgb;
vec3 grassSurface = min( vec3( 1.0 ), mix( grassMacro, grassDetail, 0.35 ) * 1.12 );
vec3 gravelSurface = texture2D( terrainGravelMap, vMapUv * 1.35 ).rgb;
vec3 rockSurface = texture2D( terrainRockMap, vMapUv * 0.42 ).rgb;
diffuseColor.rgb *= grassSurface * weights.x + gravelSurface * weights.y + rockSurface * weights.z;
if ( terrainDebugView > 0.5 ) {
  diffuseColor.rgb = weights;
}
#endif`,
        )
    }
    this.material.customProgramCacheKey = () => 'terrain-surface-splat-v1'

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
    if (this.streamingFrozen) return

    this.frameCount++
    if (this.frameCount % UPDATE_INTERVAL !== 0) return

    // The train only vibrates a few millimetres around x=0. `floor` turns
    // that harmless motion into a -1/0 chunk flip, repeatedly deleting the
    // entire far-side corridor. Round keeps streaming anchored to the rail.
    const cx = Math.round(cameraPos.x / CHUNK_SIZE)
    const cz = Math.floor(cameraPos.z / CHUNK_SIZE)

    const needed = new Set<string>()
    const pending: { x: number; z: number; priority: number }[] = []

    // Camera travels along +Z and looks toward +X (side window).
    // Grid: straddle the track on Z, extend outward on +X.
    for (let dz = -CHUNKS_BEHIND_Z; dz < CHUNKS_AHEAD_Z; dz++) {
      for (let dx = 0; dx < CHUNKS_VIEW_X; dx++) {
        const chunkX = cx + dx
        const chunkZ = cz + dz
        const key = `${chunkX},${chunkZ}`
        needed.add(key)

        if (!this.chunks.has(key)) {
          const distance = Math.abs(chunkZ - cz) * 10 + chunkX
          pending.push({ x: chunkX, z: chunkZ, priority: distance })
        }
      }
    }

    // Remove distant chunks
    for (const [key, chunk] of this.chunks) {
      if (!needed.has(key)) {
        this.removeChunk(chunk)
        this.chunks.delete(key)
        this.releasedChunks++
      }
    }

    pending.sort((a, b) => a.priority - b.priority)
    const budget = this.initialWarmup ? INITIAL_CHUNKS_PER_TICK : STREAM_CHUNKS_PER_TICK
    for (const chunk of pending.slice(0, budget)) {
      this.createChunk(chunk.x, chunk.z)
    }
    this.pendingChunks = Math.max(0, pending.length - budget)
    if (pending.length <= budget) this.initialWarmup = false
  }

  /** Manual frustum culling: hide chunks outside the view before render. */
  applyFrustumCulling(camera: THREE.Camera) {
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.projScreen)
    for (const chunk of this.chunks.values()) {
      this.chunkBox.setFromObject(chunk.mesh)
      const visible = this.frustum.intersectsBox(this.chunkBox)
      chunk.mesh.visible = visible
      for (const decoration of chunk.decorations) decoration.visible = visible
      if (chunk.grass) {
        for (const grass of chunk.grass) grass.visible = visible
      }
    }
  }

  getCurrentBiome(): BiomeType {
    return this.currentBiome
  }

  /** Number of currently active terrain chunks. */
  get chunkCount(): number {
    return this.chunks.size
  }

  get debugInfo() {
    const lodCounts = new Map<number, number>()
    for (const chunk of this.chunks.values()) {
      lodCounts.set(chunk.lod, (lodCounts.get(chunk.lod) ?? 0) + 1)
    }
    return {
      activeChunks: this.chunks.size,
      pendingChunks: this.pendingChunks,
      createdChunks: this.createdChunks,
      releasedChunks: this.releasedChunks,
      cityClusters: [...this.chunks.values()].reduce((count, chunk) => count + chunk.cityClusters, 0),
      lods: [...lodCounts.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([lod, count]) => `${lod}:${count}`)
        .join(' '),
    }
  }

  setDebugView(view: 0 | 1) {
    this.terrainDebugView = view
    if (this.terrainShader) this.terrainShader.uniforms.terrainDebugView.value = view
  }

  setStreamingFrozen(frozen: boolean) {
    this.streamingFrozen = frozen
  }

  /** The Z position where the current biome segment began. */
  get zSegmentStart(): number {
    return this.segmentStartZ
  }

  /** Current biome name (the segment the camera is inside). */
  get currentBiomeName(): BiomeType {
    return this.currentBiome
  }

  /** Next biome name (beginning at segmentStartZ + ROUTE_SEGMENT_LENGTH). */
  get nextBiomeName(): BiomeType {
    return this.nextBiome
  }

  /** Length of one biome segment in world units. */
  static readonly SEGMENT_LENGTH = ROUTE_SEGMENT_LENGTH

  /** Length of the blend transition between two segments. */
  static readonly BLEND_LENGTH = ROUTE_BLEND_LENGTH

  /** World-space terrain height under the current (possibly blending) biome. */
  sampleHeight(x: number, z: number): number {
    // Props must sit on the same triangle surface drawn by the terrain mesh.
    // Sampling the continuous noise function here made rocks, trees and crops
    // float above (or sink through) the lower-resolution rendered terrain.
    const step = CHUNK_SIZE / 64
    const x0 = Math.floor(x / step) * step
    const z0 = Math.floor(z / step) * step
    const tx = (x - x0) / step
    const tz = (z - z0) / step
    const heightAt = (sx: number, sz: number) =>
      this.terrainGen.getHeight(sx, sz, this.getBiomeAt(sz).params)

    const h00 = heightAt(x0, z0)
    const h10 = heightAt(x0 + step, z0)
    const h01 = heightAt(x0, z0 + step)
    const h11 = heightAt(x0 + step, z0 + step)

    // PlaneGeometry uses the top-left/bottom-left/top-right diagonal.
    if (tx + tz <= 1) {
      return h00 * (1 - tx - tz) + h10 * tx + h01 * tz
    }
    return h01 * (1 - tx) + h10 * (1 - tz) + h11 * (tx + tz - 1)
  }

  isBiomeAt(z: number, type: BiomeType): boolean {
    return this.getBiomeAt(z).type === type
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

  private getBiomeAt(z: number): BiomeSample {
    const route = sampleRouteFeature(z)
    const from = getBiomeConfig(route.current.biome)
    const to = getBiomeConfig(route.next.biome)
    return {
      type: route.current.biome,
      next: route.next.biome,
      segmentIndex: route.segmentIndex,
      segmentStart: route.segmentStart,
      params: this.lerpParams(
        { ...from.heightParams, road: route.current.road },
        { ...to.heightParams, road: route.next.road },
        route.blend,
      ),
      colors: this.lerpColors(from.colors, to.colors, route.blend),
      decorDensity: THREE.MathUtils.lerp(from.decorDensity, to.decorDensity, route.blend),
    }
  }

  private updateBiomeTransition(cameraZ: number) {
    const sample = this.getBiomeAt(cameraZ)
    this.currentBiome = sample.type
    this.nextBiome = sample.next
    this.segmentStartZ = sample.segmentStart
    this.activeParams = sample.params
  }

  private lerpParams(a: HeightParams, b: HeightParams, t: number): HeightParams {
    return {
      baseHeight: THREE.MathUtils.lerp(a.baseHeight, b.baseHeight, t),
      amplitude: THREE.MathUtils.lerp(a.amplitude, b.amplitude, t),
      frequency: THREE.MathUtils.lerp(a.frequency, b.frequency, t),
      octaves: Math.round(THREE.MathUtils.lerp(a.octaves, b.octaves, t)),
      persistence: THREE.MathUtils.lerp(a.persistence, b.persistence, t),
      river: THREE.MathUtils.lerp(a.river ?? 0, b.river ?? 0, t),
      road: THREE.MathUtils.lerp(a.road ?? 0, b.road ?? 0, t),
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
      for (const grass of chunk.grass) {
        this.parent.remove(grass)
        // Geometries/materials are shared by TerrainLOD, while each
        // InstancedMesh owns a GPU instance-data buffer.
        grass.dispose()
      }
    }

    for (const decor of chunk.decorations) {
      this.parent.remove(decor)
      this.disposeDecoration(decor)
    }
  }

  private disposeDecoration(decor: THREE.Object3D) {
    decor.traverse((obj) => {
      if (obj instanceof THREE.Mesh && !obj.userData.sharedTerrainResource) {
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
    disc.userData.sharedTerrainResource = true
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
    densityScale: number,
    sampleSurfaceHeight: SurfaceHeightSampler,
  ): THREE.InstancedMesh[] {
    // Dense coverage: single-quad sprites are cheap enough for high density
    const spacing = densityScale >= 1 ? 2.3 : densityScale >= 0.5 ? 3.6 : 6.0
    const cols = Math.floor(CHUNK_SIZE / spacing)
    const rows = Math.floor(CHUNK_SIZE / spacing)
    if (cols === 0 || rows === 0) return []

    // Collect matrix elements into flat arrays per variant (no Matrix4 allocs)
    const variantData: number[][] = [[], [], [], []]
    const dummy = new THREE.Object3D()
    // Slope sampling is the hot path (multiple noise evals per cell) —
    // only bother for near chunks where steep-bank grass is visible
    const checkSlope = densityScale >= 1

    for (let ci = 0; ci < cols; ci++) {
      for (let ri = 0; ri < rows; ri++) {
        const jx = (hash01(ci * 997 + ri * 3, worldZ * 0.001) - 0.5) * spacing * 0.6
        const jz = (hash01(ci * 13 + ri * 733, worldX * 0.001) - 0.5) * spacing * 0.6
        const x = worldX + ci * spacing + spacing / 2 + jx
        const z = worldZ + ri * spacing + spacing / 2 + jz
        const biome = this.getBiomeAt(z)
        const riverStrength = biome.params.river ?? 0
        const channel = waterChannelAt(z)

        if (Math.abs(x) < TRACK_FLAT_HALF + 5) continue
        if ((biome.params.road ?? 0) > 0.1 && Math.abs(x - roadCenterX(z)) < ROAD_VERGE + 1) continue
        if (channel.lakeStrength > 0.1 && Math.abs(x - farBankRoadCenterX(z)) < ROAD_VERGE + 1) continue
        if (riverStrength > 0.2 && Math.abs(x - channel.centerX) < channel.bankHalfWidth + 1.5) continue
        if (this.isRiverVillageClearing(x, z)) continue

        // Reuse the terrain grid created for this chunk. This keeps every
        // tuft exactly on the rendered triangle while avoiding four noise
        // evaluations for every candidate during streaming.
        const h = sampleSurfaceHeight(x, z)
        if (checkSlope && this.terrainGen.getSlope(x, z, biome.params) > 1.3) continue

        const rot = hash01(ci * 31 + ri * 17, worldZ) * Math.PI * 2
        const scale = 0.85 + hash01(ci * 7 + ri * 11, worldX) * 1.15
        const variant = Math.floor(hash01(ci * 5 + ri * 41, worldX + worldZ) * 4)

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

  /**
   * Builds a sampler for the exact triangulated surface of a newly-created
   * chunk. Props created with the chunk therefore share its vertex heights
   * rather than approximating the terrain with a fresh noise query.
   */
  private createChunkSurfaceSampler(
    worldX: number,
    worldZ: number,
    positions: Float32Array,
    resolution: number,
  ): SurfaceHeightSampler {
    const step = CHUNK_SIZE / resolution
    const rowWidth = resolution + 1
    const heightAt = (column: number, row: number) => positions[(row * rowWidth + column) * 3 + 1]

    return (x, z) => {
      const localX = THREE.MathUtils.clamp(x - worldX, 0, CHUNK_SIZE)
      const localZ = THREE.MathUtils.clamp(z - worldZ, 0, CHUNK_SIZE)
      const column = Math.min(resolution - 1, Math.floor(localX / step))
      const row = Math.min(resolution - 1, Math.floor(localZ / step))
      const tx = (localX - column * step) / step
      const tz = (localZ - row * step) / step
      const h00 = heightAt(column, row)
      const h10 = heightAt(column + 1, row)
      const h01 = heightAt(column, row + 1)
      const h11 = heightAt(column + 1, row + 1)

      if (tx + tz <= 1) return h00 * (1 - tx - tz) + h10 * tx + h01 * tz
      return h01 * (1 - tx) + h10 * (1 - tz) + h11 * (tx + tz - 1)
    }
  }

  private createChunk(cx: number, cz: number) {
    const worldX = cx * CHUNK_SIZE
    const worldZ = cz * CHUNK_SIZE
    // Every visible chunk uses the same grid. Mixing resolutions at shared
    // edges creates T-junctions that are conspicuous from a moving window;
    // close-range detail belongs in the material, not an edge-unsafe LOD.
    const resolution = 64

    const geometry = new THREE.PlaneGeometry(
      CHUNK_SIZE,
      CHUNK_SIZE,
      resolution,
      resolution
    )
    geometry.rotateX(-Math.PI / 2)

    const positions = geometry.attributes.position.array as Float32Array
    const colors = new Float32Array(positions.length)
    const terrainBlends = new Float32Array(positions.length)
    const centerX = worldX + CHUNK_SIZE / 2
    const centerZ = worldZ + CHUNK_SIZE / 2

    for (let i = 0; i < positions.length; i += 3) {
      // Sample in world coordinates: the track corridor flattening and the
      // noise field are both defined in world space, not chunk-local space.
      const x = positions[i] + centerX
      const z = positions[i + 2] + centerZ
      const biome = this.getBiomeAt(z)
      const { params, colors: cols } = biome
      const h = this.terrainGen.getHeight(x, z, params)
      positions[i + 1] = h

      const slope = this.terrainGen.getSlope(x, z, params)
      let color = this.computeVertexColor(h, slope, cols, params, hash01(x * 2.1, z * 2.1))

      // Ballast coloring: gravel speckle only on the rail bed itself (|x|<6).
      // Beyond that the verge is meadow — grass comes right up to the track
      // like the slowroad reference, not a wide bare gravel strip.
      const dist = Math.abs(x)
      if (dist < 6) {
        const t = THREE.MathUtils.smoothstep((dist - 4) / 4, 0, 1)
        const gravelTone = hash01(x, z) > 0.5 ? BALLAST_LIGHT : BALLAST_DARK
        color = { ...this.lerpColor(gravelTone, this.rgbToHex(color), t), isGround: false }
      } else if (color.isGround) {
        // Slowroad-style mottled meadow: low-frequency golden-straw vs
        // deep-olive patches, plus a fine per-vertex grain so the grass
        // reads as dense short turf instead of a flat gradient.
        const patch = this.terrainGen.getMottle(x, z)
        const patchStrength = Math.min(1, Math.abs(patch - 0.5) * 2) * 0.55
        const patchTone = patch > 0.5 ? MEADOW_GOLD : MEADOW_OLIVE
        color = { ...this.lerpColor(this.rgbToHex(color), patchTone, patchStrength), isGround: true }
        const grain = 0.93 + hash01(x * 3.1, z * 3.1) * 0.14
        color.r = Math.min(1, color.r * grain)
        color.g = Math.min(1, color.g * grain)
        color.b = Math.min(1, color.b * grain)
      }

      // Country road: packed dirt lane with darker wheel ruts, grass verge
      // blend on the edges. Asphalt when passing through town.
      const channel = waterChannelAt(z)
      const roadD = Math.abs(x - roadCenterX(z))
      const roadStrength = params.road ?? 0
      if (roadStrength > 0.01 && roadD < ROAD_VERGE && dist >= 6) {
        const inTown = biome.type === 'town'
        const base = inTown ? ROAD_ASPHALT : ROAD_DIRT
        const speck = 0.9 + hash01(x * 7.3, z * 7.3) * 0.2
        let roadTone = base
        if (!inTown && Math.abs(roadD - 0.9) < 0.28) roadTone = ROAD_RUT
        const edge = THREE.MathUtils.smoothstep((roadD - ROAD_HALF_WIDTH) / (ROAD_VERGE - ROAD_HALF_WIDTH), 0, 1)
        const mixed = this.lerpColor(roadTone, this.rgbToHex(color), 1 - (1 - edge) * roadStrength)
        color = { r: Math.min(1, mixed.r * speck), g: Math.min(1, mixed.g * speck), b: Math.min(1, mixed.b * speck), isGround: false }
      }

      // The far-bank access road is not a disconnected decorative stripe:
      // it only exists while the shared lakeshore channel is open.
      const lakeRoadD = Math.abs(x - farBankRoadCenterX(z))
      if (channel.lakeStrength > 0.01 && lakeRoadD < ROAD_VERGE && dist >= 6) {
        const speck = 0.9 + hash01(x * 7.3, z * 7.3) * 0.2
        let roadTone = ROAD_DIRT
        if (Math.abs(lakeRoadD - 0.9) < 0.28) roadTone = ROAD_RUT
        const edge = THREE.MathUtils.smoothstep((lakeRoadD - ROAD_HALF_WIDTH) / (ROAD_VERGE - ROAD_HALF_WIDTH), 0, 1)
        const mixed = this.lerpColor(roadTone, this.rgbToHex(color), 1 - (1 - edge) * channel.lakeStrength)
        color = { r: Math.min(1, mixed.r * speck), g: Math.min(1, mixed.g * speck), b: Math.min(1, mixed.b * speck), isGround: false }
      }

      // River banks: sandy shore hugging the channel when the river is active
      const riverStrength = params.river ?? 0
      if (riverStrength > 0.05) {
        const riverD = Math.abs(x - channel.centerX)
        if (riverD < channel.bankHalfWidth && riverD > channel.halfWidth * 0.7) {
          const t = THREE.MathUtils.smoothstep((riverD - channel.halfWidth) / (channel.bankHalfWidth - channel.halfWidth), 0, 1)
          const sandy = this.lerpColor(cols.sand, this.rgbToHex(color), t)
          color = { ...sandy, isGround: false }
        }
      }

      // Surface splatting follows the same masks that shape the scenery.
      // A little low-frequency noise keeps material boundaries from becoming
      // perfectly parallel bands while preserving the rail clearances.
      const edgeNoise = (hash01(x * 0.23, z * 0.23) - 0.5) * 0.16
      const trackWeight = 1 - THREE.MathUtils.smoothstep(dist + edgeNoise, 5, 11)
      const roadWeight = roadStrength * (1 - THREE.MathUtils.smoothstep(roadD + edgeNoise, ROAD_HALF_WIDTH, ROAD_VERGE + 1.2))
      const riverD = Math.abs(x - channel.centerX)
      const riverBankWeight = riverStrength > 0.05
        ? 1 - THREE.MathUtils.smoothstep(riverD + edgeNoise, channel.halfWidth * 0.7, channel.bankHalfWidth)
        : 0
      const lakeRoadWeight = channel.lakeStrength * (1 - THREE.MathUtils.smoothstep(lakeRoadD + edgeNoise, ROAD_HALF_WIDTH, ROAD_VERGE + 1.2))
      const gravelWeight = Math.max(trackWeight, roadWeight, lakeRoadWeight, riverBankWeight)

      const maxH = params.baseHeight + params.amplitude * 1.5
      const snowLine = maxH * 0.75
      const slopeRockWeight = THREE.MathUtils.smoothstep(slope + edgeNoise * 2, 1.2, 3.2)
      const snowRockWeight = THREE.MathUtils.smoothstep(h, snowLine, snowLine + Math.max(maxH * 0.2, 0.1))
      const rockWeight = Math.max(slopeRockWeight, snowRockWeight) * (1 - gravelWeight)
      const grassWeight = Math.max(0, 1 - gravelWeight - rockWeight)

      colors[i] = color.r
      colors[i + 1] = color.g
      colors[i + 2] = color.b
      terrainBlends[i] = grassWeight
      terrainBlends[i + 1] = gravelWeight
      terrainBlends[i + 2] = rockWeight
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('terrainBlend', new THREE.BufferAttribute(terrainBlends, 3))
    geometry.computeVertexNormals()

    const sampleChunkSurface = this.createChunkSurfaceSampler(worldX, worldZ, positions, resolution)

    const mesh = new THREE.Mesh(geometry, this.material)
    mesh.position.set(centerX, 0, centerZ)
    mesh.castShadow = true
    mesh.receiveShadow = true

    this.parent.add(mesh)
    // The mesh grid stays uniform; decoration density alone falls off with
    // distance from the rail corridor.
    const densityScale = worldX < CHUNK_SIZE ? 1 : worldX < CHUNK_SIZE * 2 ? 0.55 : 0.25
    const chunkBiome = this.getBiomeAt(centerZ)
    const decorationResult = this.createDecorations(
      cx,
      cz,
      worldX,
      worldZ,
      chunkBiome,
      densityScale,
      createSeededRandom(seedFromGrid(cx, cz, 11)),
      sampleChunkSurface,
    )
    const decorations = decorationResult.decorations
    for (const decor of decorations) {
      this.parent.add(decor)
    }
    // Dense grass sprites covering all green terrain
    const grass = this.populateGrass(worldX, worldZ, densityScale, sampleChunkSurface)
    for (const g of grass) this.parent.add(g)
    this.chunks.set(`${cx},${cz}`, {
      mesh,
      decorations,
      grass: grass.length > 0 ? grass : undefined,
      x: cx,
      z: cz,
      lod: resolution,
      cityClusters: decorationResult.cityClusters,
    })
    this.createdChunks++
  }

  private createDecorations(
    chunkX: number,
    chunkZ: number,
    worldX: number,
    worldZ: number,
    biome: BiomeSample,
    densityScale: number,
    random: RandomSource,
    sampleChunkSurface: SurfaceHeightSampler,
  ): DecorationResult {
    const decorations: THREE.Object3D[] = []
    let cityClusters = 0

    // One planned settlement per town segment, anchored to the country road.
    // It is intentionally not repeated in each chunk of a town biome.
    const townSite = this.getTownSite(chunkX, chunkZ)
    if (townSite && densityScale >= 0.5) {
      decorations.push(createTownCluster(townSite.x, townSite.z, (x, z) => this.sampleHeight(x, z), random))
      cityClusters++
    }

    const riverVillageSite = this.getRiverVillageSite(chunkX, chunkZ)
    if (riverVillageSite && densityScale >= 0.5) {
      decorations.push(createRiverVillage(
        riverVillageSite.bridgeZ,
        riverVillageSite.z,
        (x, z) => this.sampleHeight(x, z),
        random,
      ))
      cityClusters++
    }

    const attempts = Math.floor(biome.decorDensity * 58 * densityScale)

    for (let i = 0; i < attempts; i++) {
      const x = worldX + random() * CHUNK_SIZE
      const z = worldZ + random() * CHUNK_SIZE
      const localBiome = this.getBiomeAt(z)
      const localRiverStrength = localBiome.params.river ?? 0
      const channel = waterChannelAt(z)

      // Keep the rail corridor clear of trees/rocks
      if (Math.abs(x) < TRACK_FLAT_HALF + 4) continue
      // Keep the country road clear
      if ((localBiome.params.road ?? 0) > 0.1 && Math.abs(x - roadCenterX(z)) < ROAD_VERGE + 1) continue
      if (channel.lakeStrength > 0.1 && Math.abs(x - farBankRoadCenterX(z)) < ROAD_VERGE + 1) continue
      // Keep the river channel clear
      if (localRiverStrength > 0.2 && Math.abs(x - channel.centerX) < channel.bankHalfWidth + 2) continue
      // Planned river access and house lots stay free of random vegetation.
      if (this.isRiverVillageClearing(x, z)) continue

      const height = sampleChunkSurface(x, z)
      const slope = this.terrainGen.getSlope(x, z, localBiome.params)

      // Steep ground: no trees or buildings, but rock outcrops grip the slope
      if (slope >= 2) {
        if (slope < 4.5 && random() < 0.45) {
          const outcrop = this.createRockOutcrop(random)
          outcrop.position.set(x, height - 0.35, z)
          outcrop.rotation.y = random() * Math.PI * 2
          const s = 0.9 + random() * 1.6
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

      // Homes only live inside planned settlements. Generic decoration stays
      // natural, preserving readable roads and an open rail-side verge.
      const roll = random()
      let decor: THREE.Object3D
      if (roll < 0.54) {
        decor = this.createTreeBillboard(densityScale, random)
      } else if (roll < 0.68) {
        decor = this.createRock(random)
      } else if (roll < 0.84) {
        decor = this.createBushBillboard(random)
      } else if (roll < 0.95) {
        decor = this.createFlowerPatch(random)
      } else {
        decor = this.createRockOutcrop(random)
      }
      decor.position.set(x, height - 0.12, z) // sink slightly — roots grip the slope
      decor.rotation.y = random() * Math.PI * 2
      const s = 0.8 + random() * 0.7
      decor.scale.setScalar(s)
      decorations.push(decor)
    }

    return { decorations, cityClusters }
  }

  private getTownSite(chunkX: number, chunkZ: number): { x: number; z: number } | null {
    const firstSegment = Math.floor((chunkZ * CHUNK_SIZE) / ROUTE_SEGMENT_LENGTH) - 1
    for (let segmentIndex = firstSegment; segmentIndex <= firstSegment + 2; segmentIndex++) {
      if (routeFeatureForSegment(segmentIndex).biome !== 'town') continue

      const random = createSeededRandom(seedFromGrid(segmentIndex, 0, 29))
      const z = segmentIndex * ROUTE_SEGMENT_LENGTH + ROUTE_SEGMENT_LENGTH * (0.3 + random() * 0.38)
      const x = roadCenterX(z)
      if (Math.floor(x / CHUNK_SIZE) === chunkX && Math.floor(z / CHUNK_SIZE) === chunkZ) {
        return { x, z }
      }
    }
    return null
  }

  /** One far-bank hamlet is positioned after the fixed road bridge in each
   * river segment. Owning it from the village chunk keeps streaming stable. */
  private getRiverVillageSite(chunkX: number, chunkZ: number): { bridgeZ: number; x: number; z: number } | null {
    const firstSegment = Math.floor((chunkZ * CHUNK_SIZE) / ROUTE_SEGMENT_LENGTH) - 1
    for (let segmentIndex = firstSegment; segmentIndex <= firstSegment + 2; segmentIndex++) {
      if (routeFeatureForSegment(segmentIndex).biome !== 'river') continue
      const segmentStart = segmentIndex * ROUTE_SEGMENT_LENGTH
      const z = segmentStart + RIVER_VILLAGE_OFFSET
      const x = farBankRoadCenterX(z)
      if (Math.floor(x / CHUNK_SIZE) === chunkX && Math.floor(z / CHUNK_SIZE) === chunkZ) {
        return { bridgeZ: segmentStart + RIVER_BRIDGE_OFFSET, x, z }
      }
    }
    return null
  }

  /** Clear vegetation where the access road, lots, and jetty have a planned
   * purpose. This is calculated from world coordinates for every chunk. */
  private isRiverVillageClearing(x: number, z: number): boolean {
    const segmentIndex = Math.floor(z / ROUTE_SEGMENT_LENGTH)
    if (routeFeatureForSegment(segmentIndex).biome !== 'river') return false
    const segmentStart = segmentIndex * ROUTE_SEGMENT_LENGTH
    const bridgeZ = segmentStart + RIVER_BRIDGE_OFFSET
    const villageZ = segmentStart + RIVER_VILLAGE_OFFSET
    const farRoadX = farBankRoadCenterX(z)
    if (z >= bridgeZ - 4 && z <= villageZ + 128 && Math.abs(x - farRoadX) < 5.5) return true
    const channel = waterChannelAt(z)
    if (Math.abs(z - villageZ) < 110 && x > channel.centerX + channel.halfWidth - 2 && x < farRoadX + 15) return true
    return false
  }

  // ---- Vegetation billboards ----

  /** Tree billboard: crossed quads textured with a pre-rendered tree sprite.
   *  Near chunks use the detailed sheet, far chunks the silhouette sheet. */
  private createTreeBillboard(densityScale: number, random: RandomSource): THREE.Group {
    const tree = new THREE.Group()
    const near = densityScale >= 0.5
    const variant = Math.floor(random() * 8)
    const geom = near ? this.treeGeomsNear[variant] : this.treeGeomsFar[variant]
    const mat = near
      ? (variant < 4 ? this.treeMatNear : this.treeMatNearB)
      : (variant < 4 ? this.treeMatFar : this.treeMatFarB)
    const sprite = new THREE.Mesh(geom, mat)
    sprite.userData.sharedTerrainResource = true
    sprite.castShadow = near // far sprites skip the alpha-tested shadow pass
    tree.add(sprite)
    this.addShadow(tree, 1.2)
    return tree
  }

  /** Bush billboard: crossed quads with a pre-rendered bush sprite. */
  private createBushBillboard(random: RandomSource): THREE.Group {
    const bush = new THREE.Group()
    const variant = Math.floor(random() * 4)
    const sprite = new THREE.Mesh(this.bushGeoms[variant], this.bushMat)
    sprite.userData.sharedTerrainResource = true
    sprite.castShadow = true
    bush.add(sprite)
    this.addShadow(bush, 0.8)
    return bush
  }

  private createRock(random: RandomSource): THREE.Mesh {
    const size = 0.5 + random() * 0.5
    const geom = new THREE.DodecahedronGeometry(size, 0)
    const mat = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.8, flatShading: true })
    const rock = new THREE.Mesh(geom, mat)
    rock.castShadow = true
    this.addShadow(rock, size * 0.6)
    return rock
  }

  /** Small flower patch: cluster of tiny colored spheres */
  private createFlowerPatch(random: RandomSource): THREE.Group {
    const patch = new THREE.Group()
    // White-dominant daisy palette, per the slowroad reference
    const colors = [0xffffff, 0xffffff, 0xf5f0dc, 0xffffff, 0xffe9a8]
    const count = 3 + Math.floor(random() * 4)
    for (let i = 0; i < count; i++) {
      const r = 0.04 + random() * 0.04
      const geom = new THREE.SphereGeometry(r, 4, 3)
      const mat = new THREE.MeshStandardMaterial({
        color: colors[Math.floor(random() * colors.length)],
        roughness: 0.6,
      })
      const flower = new THREE.Mesh(geom, mat)
      flower.position.set(
        (random() - 0.5) * 0.6,
        0.05 + random() * 0.1,
        (random() - 0.5) * 0.6
      )
      patch.add(flower)
    }
    return patch
  }

  /** Rock outcrop: a cluster of angular boulders + flat strata slabs that
   *  breaks up grassy slopes — grey-brown jittered stone, not smooth pebbles. */
  private createRockOutcrop(random: RandomSource): THREE.Group {
    const group = new THREE.Group()
    const boulderCount = 2 + Math.floor(random() * 3)
    for (let i = 0; i < boulderCount; i++) {
      const size = 0.5 + random() * 0.9
      const geom = new THREE.DodecahedronGeometry(size, 0)
      const shade = 0.42 + random() * 0.2
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.08 + random() * 0.03, 0.06 + random() * 0.08, shade),
        roughness: 0.95,
        flatShading: true,
      })
      const rock = new THREE.Mesh(geom, mat)
      rock.position.set(
        (random() - 0.5) * 2.2,
        size * (0.3 + random() * 0.3),
        (random() - 0.5) * 2.2
      )
      rock.rotation.set(random() * 0.6, random() * Math.PI, random() * 0.6)
      rock.castShadow = true
      group.add(rock)
    }
    // Strata slab: a thin tilted slab leaning against the boulders
    if (random() < 0.7) {
      const slabMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.09, 0.07, 0.36 + random() * 0.12),
        roughness: 0.9,
        flatShading: true,
      })
      const slab = new THREE.Mesh(new THREE.BoxGeometry(1.6 + random(), 0.22, 0.9 + random() * 0.5), slabMat)
      slab.position.set((random() - 0.5) * 1.5, 0.35 + random() * 0.4, (random() - 0.5) * 1.5)
      slab.rotation.set(0.3 + random() * 0.5, random() * Math.PI, (random() - 0.5) * 0.3)
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
    params: HeightParams,
    grainNoise: number,
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
      const grain = 0.88 + grainNoise * 0.24
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
    const tint = this.lerpColor(this.rgbToHexNum(groundTint), 0xffffff, 0.76)
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
