import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { GeoData, type GeoPoint, type MappedFeature } from './GeoData'
import { SceneryAssets, type SceneryAsset, type SceneryPlacement } from '../terrain/SceneryAssets'
import { hash01 } from '../core/procedural'
import { groundGrassTex, groundRockTex } from '../textures'

const TILE = 256
interface RealChunk { group: THREE.Group; ground: THREE.Mesh; x: number; z: number }
const shapeOf = (feature: MappedFeature) => {
  const shape = new THREE.Shape(feature.coordinates.map(p => new THREE.Vector2(p.x, -p.z)))
  for (const hole of feature.holes) shape.holes.push(new THREE.Path(hole.map(p => new THREE.Vector2(p.x, -p.z))))
  return shape
}
const overlaps = (f: MappedFeature, x: number, z: number) => f.bounds[0] <= x + TILE && f.bounds[2] >= x && f.bounds[1] <= z + TILE && f.bounds[3] >= z

/** A source-backed world, kept in fixed geographical metres. Only the parent
 * transform follows the train: geometry and UVs never move relative to GIS. */
export class RealWorld {
  readonly group = new THREE.Group()
  readonly routeLine: THREE.Line
  readonly marker = new THREE.Mesh(new THREE.ConeGeometry(7, 20, 4), new THREE.MeshBasicMaterial({ color: 0xe4b654, depthTest: false }))
  private chunks = new Map<string, RealChunk>()
  private background: THREE.Mesh | null = null
  private backgroundKey = ''
  private forestCanopies: THREE.InstancedMesh | null = null
  private canopyGeometry = new THREE.SphereGeometry(1, 6, 5)
  private canopyMaterial = new THREE.MeshStandardMaterial({ color: 0x536d46, roughness: 1 })
  private landMask: THREE.CanvasTexture
  private assets = new SceneryAssets()
  private disposed = false
  private frame = 0
  private waterGroup = new THREE.Group()
  private groundMaterial: THREE.MeshStandardMaterial
  private outlineMaterial = new THREE.LineBasicMaterial({ color: 0xf1e8c2, transparent: true, opacity: 0.7, depthTest: false })
  private roadMaterial = new THREE.MeshStandardMaterial({ color: 0x747570, roughness: 1 })
  private ballastMaterial = new THREE.MeshStandardMaterial({ color: 0x948d7c, roughness: 1 })
  private railMaterial = new THREE.MeshStandardMaterial({ color: 0x9b9f9e, roughness: 0.5, metalness: 0.5 })
  private roofMaterial = new THREE.MeshStandardMaterial({ color: 0x72756f, roughness: 1 })
  private wallMaterial = new THREE.MeshStandardMaterial({ color: 0xd7d3c6, roughness: 1 })
  private tieMaterial = new THREE.MeshStandardMaterial({ color: 0x736353, roughness: 1 })
  private engineeringGeometry = new THREE.BoxGeometry(1, 1, 1)
  private engineeringMaterial = new THREE.MeshStandardMaterial({ color: 0x656963, roughness: 1 })
  private tieGeometry = new THREE.BoxGeometry(2.5, 0.14, 0.22)
  private rails: { a: GeoPoint; b: GeoPoint; s: number; end: number }[] = []
  pending = 0
  get chunkCount() { return this.chunks.size }
  get assetStatus() { return `${this.assets.loaded}/${this.assets.total}${this.assets.failed ? ` · ${this.assets.failed} 失败` : ''}` }
  get visibleTiles() { return [...this.chunks.values()].map(c => ({ x: c.x, z: c.z, mesh: c.ground })) }

  readonly data: GeoData
  constructor(data: GeoData) {
    this.data = data
    this.landMask = this.buildLandMask()
    this.group.name = 'real-hudson-world'
    this.groundMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, map: groundGrassTex, roughness: 0.95 })
    this.groundMaterial.onBeforeCompile = shader => {
      shader.uniforms.geoRock = { value: groundRockTex }
      shader.uniforms.geoLandMask = { value: this.landMask }
      shader.uniforms.geoBounds = { value: new THREE.Vector4(...data.bundle.dem.bounds) }
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 geoPosition;\nvarying vec3 geoNormal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ngeoPosition = position; geoNormal = normal;')
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D geoRock;\nuniform sampler2D geoLandMask;\nuniform vec4 geoBounds;\nvarying vec3 geoPosition;\nvarying vec3 geoNormal;')
        .replace('#include <map_fragment>', `
#ifdef USE_MAP
vec2 landUv = (geoPosition.xz - geoBounds.xy) / (geoBounds.zw - geoBounds.xy);
vec4 land = texture2D(geoLandMask, landUv);
if (land.r > 0.5) discard;
diffuseColor.rgb *= mix(vec3(1.0),vec3(0.58,0.76,0.54),land.g);
vec3 n = normalize(geoNormal);
vec3 blend = pow(abs(n), vec3(4.0)); blend /= max(dot(blend,vec3(1.0)),0.001);
vec3 rock = texture2D(geoRock,geoPosition.zy*0.055).rgb*blend.x + texture2D(geoRock,geoPosition.xz*0.055).rgb*blend.y + texture2D(geoRock,geoPosition.xy*0.055).rgb*blend.z;
vec3 grass = texture2D(map,geoPosition.xz*0.085).rgb;
diffuseColor.rgb *= mix(grass*1.1,rock,smoothstep(0.13,0.5,1.0-abs(n.y)));
#endif`)
    }
    this.groundMaterial.customProgramCacheKey = () => 'geographic-terrain-v2'
    for (let s = 0; s < data.length; s += 4) this.rails.push({ a: data.pose(s), b: data.pose(Math.min(data.length, s + 4)), s, end: Math.min(data.length, s + 4) })
    const points = data.points.map((p, i) => new THREE.Vector3(p.x, data.railHeight(data.distances[i]) + 1.5, p.z))
    this.routeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xf0c66b, depthTest: false }))
    this.routeLine.renderOrder = 100
    this.marker.rotation.x = Math.PI; this.marker.renderOrder = 110
    this.group.add(this.routeLine, this.marker, this.waterGroup)
    this.buildWater()
    void this.assets.load().then(() => {
      if (this.disposed) return
      this.clearChunks(); this.frame = 0
    })
  }
  /** Rail-bed correction is a narrow engineering visualization, not a new
   * geographical landform. Bridges/tunnels keep their ground DEM below/above. */
  terrainHeight(x: number, z: number) {
    const raw = this.data.heightAt(x, z)
    if (raw === null) return null
    const near = this.data.railProximity(x, z)
    if (near.distance < 18 && !this.data.engineeringAt(x, z)) {
      const t = THREE.MathUtils.smoothstep(near.distance, 4, 18)
      return THREE.MathUtils.lerp(this.data.railHeight(near.s) - 0.25, raw, t)
    }
    return raw
  }
  update(s: number, inspection: boolean, focus: THREE.Vector3, layers: { ground: boolean; vegetation: boolean; settlements: boolean; water: boolean; farmland: boolean }) {
    const pose = this.data.pose(s)
    if (inspection) { this.group.position.set(0, 0, 0); this.group.rotation.y = 0 }
    else {
      this.group.rotation.y = -pose.heading
      this.group.position.set(-pose.dz * pose.x + pose.dx * pose.z, 0, s - pose.dx * pose.x - pose.dz * pose.z)
    }
    this.routeLine.visible = this.marker.visible = inspection
    this.marker.position.set(pose.x, this.data.railHeight(s) + 22, pose.z)
    this.waterGroup.visible = layers.water
    const point = inspection ? focus : pose
    const bx = Math.floor(point.x / TILE), bz = Math.floor(point.z / TILE)
    const side = pose.dz >= 0 ? 1 : -1
    const wanted = new Map<string, { x: number; z: number }>()
    for (let row = -1; row <= 1; row++) for (let col = 0; col < 2; col++) {
      const x = bx + col * side, z = bz + row
      wanted.set(`${x},${z}`, { x, z })
    }
    for (const [key, chunk] of this.chunks) if (!wanted.has(key)) { this.disposeChunk(chunk); this.chunks.delete(key) }
    const missing = [...wanted.entries()].filter(([key]) => !this.chunks.has(key))
    const budget = this.chunks.size ? 2 : 6
    if (this.frame++ % 3 === 0 || !this.chunks.size) for (const [key, tile] of missing.slice(0, budget)) this.chunks.set(key, this.createChunk(tile.x, tile.z))
    this.pending = [...wanted.keys()].filter(key => !this.chunks.has(key)).length
    for (const chunk of this.chunks.values()) {
      chunk.ground.visible = layers.ground
      for (const child of chunk.group.children) {
        const layer = child.userData.geoLayer
        if (layer === 'vegetation') child.visible = layers.vegetation
        if (layer === 'settlement') child.visible = layers.settlements
        if (layer === 'farmland') child.visible = layers.farmland
        if (layer === 'inspection') child.visible = inspection
      }
    }
    this.updateBackground(point.x, point.z, [...wanted.values()])
    if (this.background) this.background.visible = layers.ground
    if (this.forestCanopies) this.forestCanopies.visible = layers.vegetation
  }
  private terrainGeometry(minX: number, minZ: number, width: number, depth: number, step: number, excluded?: { minX: number; minZ: number; maxX: number; maxZ: number }) {
    const cols = Math.round(width / step), rows = Math.round(depth / step)
    const positions: number[] = [], colors: number[] = [], normals: number[] = [], uv: number[] = [], indices: number[] = [], valid: boolean[] = []
    for (let row = 0; row <= rows; row++) for (let col = 0; col <= cols; col++) {
      const x = minX + col * step, z = minZ + row * step
      const h = this.terrainHeight(x, z)
      valid.push(h !== null); positions.push(x, h ?? 0, z); uv.push(x * 0.08, z * 0.08)
      const hx0 = this.terrainHeight(x - 4, z) ?? h ?? 0, hx1 = this.terrainHeight(x + 4, z) ?? h ?? 0
      const hz0 = this.terrainHeight(x, z - 4) ?? h ?? 0, hz1 = this.terrainHeight(x, z + 4) ?? h ?? 0
      const normal = new THREE.Vector3(hx0 - hx1, 8, hz0 - hz1).normalize(); normals.push(normal.x, normal.y, normal.z)
      const forest = this.data.landAt(x, z, 'forest'), farm = this.data.landAt(x, z, 'farmland')
      const tint = new THREE.Color(forest ? 0xabb49a : farm ? 0xc8c092 : 0xc4c4aa)
      tint.multiplyScalar(0.97 + hash01(Math.floor(x / 20), Math.floor(z / 20)) * 0.06)
      colors.push(tint.r, tint.g, tint.b)
    }
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const x = minX + (col + 0.5) * step, z = minZ + (row + 0.5) * step
      if (excluded && x > excluded.minX && x < excluded.maxX && z > excluded.minZ && z < excluded.maxZ) continue
      const a = row * (cols + 1) + col, b = a + 1, c = a + cols + 1, d = c + 1
      if (valid[a] && valid[b] && valid[c]) indices.push(a, c, b)
      if (valid[b] && valid[c] && valid[d]) indices.push(b, c, d)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices)
    return geometry
  }
  private createChunk(cx: number, cz: number): RealChunk {
    const group = new THREE.Group(), x0 = cx * TILE, z0 = cz * TILE
    const ground = new THREE.Mesh(this.terrainGeometry(x0, z0, TILE, TILE, 8), this.groundMaterial)
    ground.receiveShadow = true; group.add(ground)
    const outline: THREE.Vector3[] = []
    for (let side = 0; side < 4; side++) for (let i = 0; i <= 32; i++) {
      const t = i * 8, x = x0 + (side === 0 ? t : side === 1 ? TILE : side === 2 ? TILE - t : 0), z = z0 + (side === 0 ? 0 : side === 1 ? t : side === 2 ? TILE : TILE - t)
      outline.push(new THREE.Vector3(x, (this.terrainHeight(x, z) ?? 0) + 0.7, z))
    }
    const edge = new THREE.Line(new THREE.BufferGeometry().setFromPoints(outline), this.outlineMaterial)
    edge.userData.geoLayer = 'inspection'; edge.renderOrder = 90; group.add(edge)
    const features = this.data.nearbyFeatures(x0 + 128, z0 + 128)
    const buildings = features.filter(f => f.kind === 'building' && Math.floor((f.bounds[0] + f.bounds[2]) / 2 / TILE) === cx && Math.floor((f.bounds[1] + f.bounds[3]) / 2 / TILE) === cz)
    const buildingGeometry: THREE.BufferGeometry[] = []
    for (const feature of buildings) {
      const x = (feature.bounds[0] + feature.bounds[2]) / 2, z = (feature.bounds[1] + feature.bounds[3]) / 2
      const base = this.terrainHeight(x, z)
      if (base === null || this.data.landAt(x, z, 'water')) continue
      const tagged = Number.parseFloat(feature.tags.height ?? '')
      const levels = Number.parseFloat(feature.tags['building:levels'] ?? '')
      const height = Math.min(80, Math.max(2.5, Number.isFinite(tagged) ? tagged : Number.isFinite(levels) ? levels * 3.1 : /commercial|industrial|apartments/.test(feature.tags.building ?? '') ? 10 : 6.2))
      const geometry = new THREE.ExtrudeGeometry(shapeOf(feature), { depth: height, bevelEnabled: false, steps: 1 })
      geometry.rotateX(-Math.PI / 2); geometry.translate(0, base - 0.1, 0)
      buildingGeometry.push(geometry)
    }
    if (buildingGeometry.length) {
      const merged = mergeGeometries(buildingGeometry, false)
      if (merged) {
        let offset = 0
        for (const geometry of buildingGeometry) {
          for (const part of geometry.groups) merged.addGroup(offset + part.start, part.count, part.materialIndex)
          offset += geometry.index?.count ?? geometry.getAttribute('position').count
        }
      }
      for (const geometry of buildingGeometry) geometry.dispose()
      if (merged) { const mesh = new THREE.Mesh(merged, [this.roofMaterial, this.wallMaterial]); mesh.userData.geoLayer = 'settlement'; mesh.receiveShadow = true; group.add(mesh) }
    }
    for (const f of features) if (f.kind === 'road' && overlaps(f, x0, z0)) {
      const width = /motorway|trunk/.test(f.tags.highway ?? '') ? 8 : /primary|secondary/.test(f.tags.highway ?? '') ? 5 : 3
      const mesh = this.ribbon(f.coordinates, width, (x, z) => this.terrainHeight(x, z), x0, z0, this.roadMaterial)
      if (mesh) { mesh.userData.geoLayer = 'settlement'; group.add(mesh) }
    }
    this.addTracks(group, x0, z0)
    this.addVegetation(group, x0, z0)
    this.group.add(group)
    return { group, ground, x: cx, z: cz }
  }
  private ribbon(points: GeoPoint[], width: number, height: (x: number, z: number) => number | null, x0: number, z0: number, material: THREE.Material) {
    const vertices: number[] = []
    const sampled: GeoPoint[] = []
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 16))
      if (i === 1) sampled.push(a)
      for (let j = 1; j <= steps; j++) sampled.push({ x: THREE.MathUtils.lerp(a.x, b.x, j / steps), z: THREE.MathUtils.lerp(a.z, b.z, j / steps) })
    }
    for (let i = 1; i < sampled.length; i++) {
      const a = sampled[i - 1], b = sampled[i], mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2
      if (mx < x0 || mx >= x0 + TILE || mz < z0 || mz >= z0 + TILE) continue
      const length = Math.hypot(b.x - a.x, b.z - a.z)
      if (!length) continue
      const nx = (b.z - a.z) / length * width / 2, nz = -(b.x - a.x) / length * width / 2
      const corners = [[a.x - nx, a.z - nz], [a.x + nx, a.z + nz], [b.x - nx, b.z - nz], [b.x + nx, b.z + nz]]
      const ys = corners.map(([x, z]) => height(x, z))
      if (ys.some(y => y === null)) continue
      for (const index of [0, 2, 1, 1, 2, 3]) vertices.push(corners[index][0], ys[index]! + 0.12, corners[index][1])
    }
    if (!vertices.length) return null
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.computeVertexNormals()
    const mesh = new THREE.Mesh(geometry, material); mesh.receiveShadow = true
    return mesh
  }
  private addTracks(group: THREE.Group, x0: number, z0: number) {
    const engineering: THREE.Matrix4[] = []
    const ties: THREE.Matrix4[] = [], matrix = new THREE.Object3D(), ballast: number[] = [], rails: number[] = []
    for (const segment of this.rails) {
      const { a, b, s, end } = segment, mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2
      if (mx < x0 || mx >= x0 + TILE || mz < z0 || mz >= z0 + TILE) continue
      const poseA = this.data.pose(s), poseB = this.data.pose(end)
      const center = this.data.pose((s + end) / 2), type = this.data.engineeringKindAt(center.x, center.z)
      const block = (offset: number, rise: number, width: number, height: number) => {
        matrix.position.set(center.x + center.dz * offset, this.data.railHeight((s + end) / 2) + rise, center.z - center.dx * offset)
        matrix.rotation.set(0, center.heading, 0); matrix.scale.set(width, height, end - s + 0.2); matrix.updateMatrix(); engineering.push(matrix.matrix.clone())
      }
      if (type === 'tunnel') { block(-3.8, 1.5, 0.35, 9); block(3.8, 1.5, 0.35, 9); block(0, 6, 8, 0.4); block(0, -0.5, 8, 0.4) }
      else if (type === 'bridge') block(0, -0.45, 5.5, 0.5)
      const strip = (center: number, width: number, rise: number, output: number[]) => {
        const corners = [
          [a.x + poseA.dz * (center - width / 2), this.data.railHeight(s) + rise, a.z - poseA.dx * (center - width / 2)],
          [a.x + poseA.dz * (center + width / 2), this.data.railHeight(s) + rise, a.z - poseA.dx * (center + width / 2)],
          [b.x + poseB.dz * (center - width / 2), this.data.railHeight(end) + rise, b.z - poseB.dx * (center - width / 2)],
          [b.x + poseB.dz * (center + width / 2), this.data.railHeight(end) + rise, b.z - poseB.dx * (center + width / 2)],
        ]
        for (const i of [0, 2, 1, 1, 2, 3]) output.push(...corners[i])
      }
      strip(0, 5, -0.15, ballast); strip(-0.7175, 0.08, 0.15, rails); strip(0.7175, 0.08, 0.15, rails)
      for (let distance = s; distance < end; distance += 0.8) {
        const p = this.data.pose(distance)
        matrix.position.set(p.x, this.data.railHeight(distance), p.z); matrix.rotation.set(0, p.heading, 0); matrix.scale.set(1, 1, 1); matrix.updateMatrix(); ties.push(matrix.matrix.clone())
      }
    }
    for (const [values, material] of [[ballast, this.ballastMaterial], [rails, this.railMaterial]] as const) if (values.length) {
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(values, 3)); geometry.computeVertexNormals(); group.add(new THREE.Mesh(geometry, material))
    }
    if (engineering.length) {
      const mesh = new THREE.InstancedMesh(this.engineeringGeometry, this.engineeringMaterial, engineering.length); mesh.userData.sharedGeometry = true
      for (let i = 0; i < engineering.length; i++) mesh.setMatrixAt(i, engineering[i])
      mesh.computeBoundingSphere(); group.add(mesh)
    }
    if (ties.length) {
      const mesh = new THREE.InstancedMesh(this.tieGeometry, this.tieMaterial, ties.length)
      mesh.userData.sharedGeometry = true
      for (let i = 0; i < ties.length; i++) mesh.setMatrixAt(i, ties[i])
      mesh.computeBoundingSphere(); group.add(mesh)
    }
  }
  private addVegetation(group: THREE.Group, x0: number, z0: number) {
    const parent = new THREE.Group(); parent.userData.geoLayer = 'vegetation'; group.add(parent)
    const batches = new Map<SceneryAsset, SceneryPlacement[]>()
    for (let col = 0; col < 16; col++) for (let row = 0; row < 16; row++) {
      const x = x0 + col * 16 + 8 + (hash01(col + x0, row + z0) - 0.5) * 9
      const z = z0 + row * 16 + 8 + (hash01(row + z0, col + x0, 9) - 0.5) * 9
      if (!this.data.landAt(x, z, 'forest') || this.data.landAt(x, z, 'water') || this.data.landAt(x, z, 'building') || this.data.railProximity(x, z).distance < 12) continue
      const height = this.terrainHeight(x, z)
      if (height === null) continue
      const delta = Math.abs((this.terrainHeight(x + 4, z) ?? height) - (this.terrainHeight(x - 4, z) ?? height))
      if (delta > 10 || hash01(x, z, 4) < 0.12) continue
      const asset: SceneryAsset = hash01(x, z, 7) > 0.5 ? 'broadleaf' : 'oak'
      const batch = batches.get(asset) ?? []
      batch.push({ x, z, y: height - 0.12, height: 8 + hash01(x, z, 8) * 7, yaw: hash01(x, z, 10) * Math.PI * 2 }); batches.set(asset, batch)
    }
    for (const [asset, placements] of batches) this.assets.addInstances(parent, asset, placements)
  }
  /** Rasterized OSM polygons mask the terrain surface, so coarse mountain
   * triangles cannot create fictitious islands or erase shoreline holes. */
  private buildLandMask() {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4096
    const ctx = canvas.getContext('2d')!
    const [minX, minZ, maxX, maxZ] = this.data.bundle.dem.bounds
    ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    for (const kind of ['forest', 'water'] as const) for (const feature of this.data.features) if (feature.kind === kind) {
      ctx.beginPath()
      for (const ring of [feature.coordinates, ...feature.holes]) {
        ring.forEach((point, i) => {
          const x = (point.x - minX) / (maxX - minX) * canvas.width, y = (maxZ - point.z) / (maxZ - minZ) * canvas.height
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
        }); ctx.closePath()
      }
      ctx.fillStyle = kind === 'water' ? '#ff0000' : '#00ff00'; ctx.fill('evenodd')
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = false
    return texture
  }
  private buildWater() {
    for (const feature of this.data.features) if (feature.kind === 'water' && feature.coordinates.length >= 3) {
      const samples = feature.coordinates.map(p => this.data.heightAt(p.x, p.z)).filter((h): h is number => h !== null).sort((a, b) => a - b)
      if (!samples.length) continue
      const largeRiver = feature.tags.name === 'Hudson River' || (feature.bounds[2] - feature.bounds[0]) * (feature.bounds[3] - feature.bounds[1]) > 2e6
      const y = largeRiver ? 0.3 : samples[Math.floor(samples.length * 0.2)] + 0.08
      const geometry = new THREE.ShapeGeometry(shapeOf(feature)); geometry.rotateX(-Math.PI / 2); geometry.translate(0, y, 0)
      const material = new THREE.MeshStandardMaterial({ color: largeRiver ? 0x588895 : 0x638a87, roughness: 0.35, metalness: 0.1, side: THREE.DoubleSide })
      this.waterGroup.add(new THREE.Mesh(geometry, material))
    }
  }
  private updateBackground(_x: number, _z: number, tiles: { x: number; z: number }[]) {
    const minX = Math.min(...tiles.map(t => t.x)) * TILE, maxX = (Math.max(...tiles.map(t => t.x)) + 1) * TILE
    const minZ = Math.min(...tiles.map(t => t.z)) * TILE, maxZ = (Math.max(...tiles.map(t => t.z)) + 1) * TILE
    const key = `${minX}:${minZ}`
    if (key === this.backgroundKey) return
    const centerX = (minX + maxX) / 2, centerZ = (minZ + maxZ) / 2
    const perimeter: GeoPoint[] = []
    for (let px = minX; px < maxX; px += 8) perimeter.push({ x: px, z: minZ })
    for (let pz = minZ; pz < maxZ; pz += 8) perimeter.push({ x: maxX, z: pz })
    for (let px = maxX; px > minX; px -= 8) perimeter.push({ x: px, z: maxZ })
    for (let pz = maxZ; pz > minZ; pz -= 8) perimeter.push({ x: minX, z: pz })
    const positions: number[] = [], colors: number[] = [], normals: number[] = [], uv: number[] = [], indices: number[] = [], valid: boolean[] = []
    const scales = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16]
    for (const scale of scales) for (const p of perimeter) {
      const px = centerX + (p.x - centerX) * scale, pz = centerZ + (p.z - centerZ) * scale
      const h = this.terrainHeight(px, pz)
      valid.push(h !== null); positions.push(px, h ?? 0, pz); uv.push(px * 0.08, pz * 0.08)
      const normal = new THREE.Vector3((this.terrainHeight(px - 4, pz) ?? h ?? 0) - (this.terrainHeight(px + 4, pz) ?? h ?? 0), 8, (this.terrainHeight(px, pz - 4) ?? h ?? 0) - (this.terrainHeight(px, pz + 4) ?? h ?? 0)).normalize()
      normals.push(normal.x, normal.y, normal.z)
      const tint = new THREE.Color(this.data.landAt(px, pz, 'forest') ? 0xabb49a : this.data.landAt(px, pz, 'farmland') ? 0xc8c092 : 0xc4c4aa)
      tint.multiplyScalar(0.97 + hash01(Math.floor(px / 20), Math.floor(pz / 20)) * 0.06); colors.push(tint.r, tint.g, tint.b)
    }
    const count = perimeter.length
    for (let ring = 0; ring < scales.length - 1; ring++) for (let i = 0; i < count; i++) {
      const a = ring * count + i, b = ring * count + (i + 1) % count, c = a + count, d = b + count
      if (valid[a] && valid[b] && valid[c]) indices.push(a, b, c)
      if (valid[b] && valid[c] && valid[d]) indices.push(b, d, c)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices)
    if (this.background) { this.group.remove(this.background); this.background.geometry.dispose() }
    this.background = new THREE.Mesh(geometry, this.groundMaterial); this.background.receiveShadow = true
    this.group.add(this.background); this.backgroundKey = key
    this.forestCanopies?.dispose(); this.forestCanopies?.removeFromParent()
    // Anchor the distant canopy to the displayed DEM mesh, whose coarse
    // triangle interpolation differs from bilinear DEM on steep hills.
    const triangleBins = new Map<string, number[]>()
    for (let i = 0; i < indices.length; i += 3) {
      const triangle = indices.slice(i, i + 3)
      const xs = triangle.map(v => positions[v * 3]), zs = triangle.map(v => positions[v * 3 + 2])
      for (let tx = Math.floor(Math.min(...xs) / 256); tx <= Math.floor(Math.max(...xs) / 256); tx++) for (let tz = Math.floor(Math.min(...zs) / 256); tz <= Math.floor(Math.max(...zs) / 256); tz++) {
        const key = `${tx},${tz}`, list = triangleBins.get(key) ?? []; list.push(i); triangleBins.set(key, list)
      }
    }
    const displayedHeight = (px: number, pz: number) => {
      for (const i of triangleBins.get(`${Math.floor(px / 256)},${Math.floor(pz / 256)}`) ?? []) {
        const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3
        const ax = positions[a], az = positions[a + 2], bx = positions[b], bz = positions[b + 2], cx = positions[c], cz = positions[c + 2]
        const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
        if (Math.abs(denominator) < 1e-8) continue
        const u = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / denominator, v = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / denominator
        if (u >= -1e-6 && v >= -1e-6 && u + v <= 1.000001) return u * positions[a + 1] + v * positions[b + 1] + (1 - u - v) * positions[c + 1]
      }
      return null
    }
    const placements: THREE.Matrix4[] = [], matrix = new THREE.Object3D()
    const center = { x: Math.floor(_x / 40) * 40, z: Math.floor(_z / 40) * 40 }
    for (let dx = -2520; dx <= 2520; dx += 40) for (let dz = -2520; dz <= 2520; dz += 40) {
      const px = center.x + dx + (hash01(dx + center.x, dz + center.z) - 0.5) * 34
      const pz = center.z + dz + (hash01(dz + center.z, dx + center.x, 7) - 0.5) * 34
      if (px >= minX && px <= maxX && pz >= minZ && pz <= maxZ) continue
      if (!this.data.landAt(px, pz, 'forest') || this.data.landAt(px, pz, 'water')) continue
      const y = displayedHeight(px, pz); if (y === null) continue
      const size = 4 + hash01(px, pz, 12) * 3
      matrix.position.set(px, y + size * 0.65, pz); matrix.scale.set(size, size * 0.85, size); matrix.rotation.y = hash01(px, pz) * 6.28; matrix.updateMatrix()
      placements.push(matrix.matrix.clone())
    }
    this.forestCanopies = new THREE.InstancedMesh(this.canopyGeometry, this.canopyMaterial, placements.length)
    for (let i = 0; i < placements.length; i++) this.forestCanopies.setMatrixAt(i, placements[i])
    this.forestCanopies.computeBoundingSphere(); this.group.add(this.forestCanopies)
  }
  private disposeChunk(chunk: RealChunk) {
    chunk.group.traverse(object => {
      if (object instanceof THREE.InstancedMesh) object.dispose()
      if (object instanceof THREE.Line) object.geometry.dispose()
      if (object instanceof THREE.Mesh && !object.userData.sharedTerrainResource && !object.userData.sharedGeometry) object.geometry.dispose()
    })
    chunk.group.removeFromParent()
  }
  private clearChunks() { for (const chunk of this.chunks.values()) this.disposeChunk(chunk); this.chunks.clear() }
  dispose() {
    this.disposed = true; this.clearChunks(); this.assets.dispose()
    this.background?.geometry.dispose(); this.routeLine.geometry.dispose(); (this.routeLine.material as THREE.Material).dispose()
    this.marker.geometry.dispose(); (this.marker.material as THREE.Material).dispose()
    this.waterGroup.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose() } })
    for (const material of [this.outlineMaterial, this.groundMaterial, this.roadMaterial, this.ballastMaterial, this.railMaterial, this.roofMaterial, this.wallMaterial, this.tieMaterial]) material.dispose()
    this.forestCanopies?.dispose(); this.canopyGeometry.dispose(); this.canopyMaterial.dispose(); this.landMask.dispose(); this.engineeringGeometry.dispose(); this.engineeringMaterial.dispose()
    this.tieGeometry.dispose(); this.group.removeFromParent()
  }
}
