import * as THREE from 'three'
import { NetworkRoute, type NetworkCoordinate, type NetworkPose } from './NetworkRoute'

export type NetworkProfile = 'woodland' | 'desert' | 'coast' | 'alpine'
export interface NetworkTelemetry {
  distanceMetres: number
  lengthMetres: number
  longitude: number
  latitude: number
  speedKmh: number
  paused: boolean
  ready: boolean
  tiles: number
  drawCalls: number
  triangles: number
  frameMs: number
  error?: string
}
interface Tile {
  group: THREE.Group
  origin: NetworkPose
  geometry: THREE.BufferGeometry[]
  instances: THREE.InstancedMesh[]
}

const TILE = 256
const HALF_WIDTH = 1400
const CELL = 16
// Scenery-only endpoint skirts. They extend the terminal terrain mesh, never
// the source route, train distance, ballast, rails, sleepers or settlement data.
const FOG_FAR = 4800
const END_SCENERY = Math.ceil((FOG_FAR + 256) / TILE) * TILE
const SEA_WIDTH = 6000
const MAX_TILE_RADIUS = 8 // At most 17 cached tiles, independent of route length.
const PALLET: Record<NetworkProfile, { grass: string; dry: string; rock: string; leaf: string; fog: string; sky: string }> = {
  woodland: { grass: '#6a8153', dry: '#9c9a67', rock: '#72796c', leaf: '#41684a', fog: '#b3c9c3', sky: '#b9d4d7' },
  desert: { grass: '#c6a56e', dry: '#cba17b', rock: '#a97c62', leaf: '#657b51', fog: '#d6bfa0', sky: '#d4d8d0' },
  coast: { grass: '#8b9c66', dry: '#c3b690', rock: '#8b9490', leaf: '#4d7161', fog: '#b7cfd1', sky: '#c2dce1' },
  alpine: { grass: '#78866b', dry: '#acaa93', rock: '#939f9c', leaf: '#42665a', fog: '#b8cbd0', sky: '#c1d9e1' },
}

function random(seed: number, lane = 0) {
  let value = Math.imul(seed | 0, 374761393) ^ Math.imul(lane | 0, 668265263)
  value = Math.imul(value ^ (value >>> 13), 1274126177)
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296
}

/**
 * One real source component drives the horizontal railway. Heights, vegetation,
 * towns and coastline are explicitly generated scenery, never DEM or a survey.
 * No audio is imported, constructed or played by this class.
 */
export class NetworkWorld {
  private readonly route: NetworkRoute
  private readonly container: HTMLElement
  private readonly profile: NetworkProfile
  private readonly onTelemetry: (state: NetworkTelemetry) => void
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(60, 1, .2, 6500)
  private readonly tiles = new Map<number, Tile>()
  private readonly materials: THREE.Material[] = []
  private readonly sharedGeometry: THREE.BufferGeometry[] = []
  private readonly observer: ResizeObserver
  private readonly trunkGeometry = new THREE.CylinderGeometry(.13, .24, 1, 6)
  private readonly coneGeometry = new THREE.ConeGeometry(1, 1, 7)
  private readonly leafGeometry = new THREE.IcosahedronGeometry(1, 1)
  private readonly rockGeometry = new THREE.DodecahedronGeometry(1, 0)
  private readonly houseGeometry = new THREE.BoxGeometry(1, 1, 1)
  private readonly roofGeometry: THREE.CylinderGeometry
  private readonly trunkMaterial: THREE.MeshStandardMaterial
  private readonly leafMaterial: THREE.MeshStandardMaterial
  private readonly terrainMaterial: THREE.MeshStandardMaterial
  private readonly rockMaterial: THREE.MeshStandardMaterial
  private readonly wallMaterial: THREE.MeshStandardMaterial
  private readonly roofMaterial: THREE.MeshStandardMaterial
  private readonly ballastMaterial: THREE.MeshStandardMaterial
  private readonly railMaterial: THREE.MeshStandardMaterial
  private readonly sleeperMaterial: THREE.MeshStandardMaterial
  private readonly waterMaterial: THREE.MeshStandardMaterial
  private readonly sun = new THREE.DirectionalLight(0xffe4b4, 2.1)
  private readonly dummy = new THREE.Object3D()
  private origin: NetworkPose
  private anchorIndex = -1
  private tileRadius = 0
  private distance = 0
  private paused = true
  private speed = 60
  private overview = false
  private layers = { trees: true, buildings: true }
  private ready = false
  private disposed = false
  private contextLost = false
  private renderError: string | undefined
  private raf = 0
  private lastTime = 0
  private lastTelemetry = -Infinity
  private lastFrameMs = 0
  private yaw = 0
  private pitch = 0
  private pointer: number | null = null
  private pointerX = 0
  private pointerY = 0

  constructor(container: HTMLElement, coordinates: NetworkCoordinate[], profile: NetworkProfile,
    onTelemetry: (state: NetworkTelemetry) => void) {
    this.route = new NetworkRoute(coordinates)
    if (!Object.hasOwn(PALLET, profile)) throw new TypeError('未知生成景观类型')
    this.container = container
    this.profile = profile
    this.onTelemetry = onTelemetry
    this.origin = this.route.pose(0)
    this.roofGeometry = new THREE.CylinderGeometry(0, 1, 1, 4, 1)
    this.roofGeometry.rotateY(Math.PI / 4)
    this.sharedGeometry.push(this.trunkGeometry, this.coneGeometry, this.leafGeometry, this.rockGeometry, this.houseGeometry, this.roofGeometry)
    const palette = PALLET[profile]
    const standard = (color: THREE.ColorRepresentation, roughness = .9) => {
      const material = new THREE.MeshStandardMaterial({ color, roughness })
      this.materials.push(material)
      return material
    }
    this.trunkMaterial = standard(profile === 'desert' ? '#657649' : '#655440')
    this.leafMaterial = standard(palette.leaf)
    this.rockMaterial = standard(palette.rock)
    this.terrainMaterial = standard('#ffffff')
    this.terrainMaterial.vertexColors = true
    this.wallMaterial = standard('#d6c3a0')
    this.roofMaterial = standard(profile === 'alpine' ? '#65594e' : '#976958')
    this.ballastMaterial = standard('#858477')
    this.railMaterial = standard('#929b9b', .35)
    this.railMaterial.metalness = .65
    this.sleeperMaterial = standard('#655440')
    this.waterMaterial = standard('#568b95', .27)
    this.waterMaterial.metalness = .15
    this.scene.background = new THREE.Color(palette.sky)
    this.scene.fog = new THREE.Fog(palette.fog, 1000, FOG_FAR)
    this.scene.add(new THREE.HemisphereLight(0xe0eff2, 0x736a4c, 1.8), this.sun, this.sun.target)
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'default' })
    } catch (error) {
      this.sharedGeometry.forEach(geometry => geometry.dispose())
      this.materials.forEach(material => material.dispose())
      throw error
    }
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15
    this.renderer.info.autoReset = false
    const canvas = this.renderer.domElement
    canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:grab'
    canvas.setAttribute('aria-label', '全国铁路生成风景：真实线路，非实测地形')
    canvas.dataset.scenery = 'generated-no-dem'
    container.append(canvas)
    canvas.addEventListener('pointerdown', this.pointerDown)
    canvas.addEventListener('pointermove', this.pointerMove)
    canvas.addEventListener('pointerup', this.pointerUp)
    canvas.addEventListener('pointercancel', this.pointerUp)
    canvas.addEventListener('dblclick', this.resetView)
    canvas.addEventListener('webglcontextlost', this.onContextLost)
    document.addEventListener('visibilitychange', this.visibilityChanged)
    this.observer = new ResizeObserver(this.resize)
    this.observer.observe(container)
    try {
      this.resize()
      this.updateTiles()
    } catch (error) {
      this.dispose()
      throw error
    }
    this.raf = requestAnimationFrame(this.animate)
  }

  /** Synthetic rail profile, deliberately independent of real elevation. */
  private elevation(s: number) {
    return 14 + Math.sin(s / 1300) * 5 + Math.sin(s / 520) * 1.5
  }

  private terrain(s: number, lateral: number) {
    const rail = this.elevation(s)
    const away = THREE.MathUtils.smoothstep(Math.abs(lateral), 8, 130)
    const ridge = .55 + .25 * Math.sin(s / 370 + lateral / 730) + .2 * Math.sin(s / 117 + lateral / 193)
    const wave = Math.sin(s / 220 + lateral / 150) * 6 + Math.sin(lateral / 48 + s / 79) * 2
    let hill = ridge * Math.min(1, Math.abs(lateral) / 700) ** 1.4
    hill *= this.profile === 'alpine' ? 320 : this.profile === 'desert' ? 115 : 95
    if (this.profile === 'coast' && lateral < 0) {
      const beach = THREE.MathUtils.smoothstep(-lateral, 65, 200)
      return (rail - .35) * (1 - beach) + (-5 + wave * .15) * beach
    }
    return rail - .35 + away * (hill + wave)
  }

  private position(s: number, lateral: number, origin: NetworkPose, y = this.terrain(s, lateral)) {
    const pose = this.route.pose(s), projected = this.route.project(pose, origin)
    const sideScale = Math.cos(origin.latitude * Math.PI / 180) / Math.max(.00001, Math.cos(pose.latitude * Math.PI / 180))
    // pose() intentionally clamps the REAL component. Only generated scenery
    // may go farther: continue its endpoint tangent in the local metric frame.
    const extra = s - pose.distance
    // Right of travel: east=north component, south=east component.
    return new THREE.Vector3(projected.x + (pose.east * extra + pose.north * lateral) * sideScale,
      y, projected.z + (-pose.north * extra + pose.east * lateral) * sideScale)
  }

  private surface(start: number, end: number, minSide: number, maxSide: number, origin: NetworkPose,
    height: (s: number, side: number) => number, colorize = false, sideCells = 1) {
    const samples = new Set(this.route.samples(start, end, CELL))
    samples.add(start); samples.add(end)
    // Detailed continuation near the terminal frame; coarse rows beyond 512m
    // keep endpoint coverage finite without adding thousands of terrain tiles.
    if (start < 0) for (let s = -CELL; s > start; s -= s >= -512 ? CELL : 128) samples.add(s)
    if (end > this.route.length) for (let d = CELL; this.route.length + d < end; d += d <= 512 ? CELL : 128) samples.add(this.route.length + d)
    const distances = [...samples].filter(s => s >= start && s <= end).sort((a, b) => a - b)
    const alongCells = distances.length - 1
    const positions: number[] = [], colors: number[] = [], indices: number[] = [], normals: number[] = []
    const grass = new THREE.Color(PALLET[this.profile].grass), dry = new THREE.Color(PALLET[this.profile].dry)
    const rock = new THREE.Color(PALLET[this.profile].rock), white = new THREE.Color('#e4ecea')
    for (let row = 0; row <= alongCells; row++) {
      const s = distances[row]
      for (let col = 0; col <= sideCells; col++) {
        const side = THREE.MathUtils.lerp(minSide, maxSide, col / sideCells), y = height(s, side)
        const p = this.position(s, side, origin, y)
        positions.push(p.x, p.y, p.z)
        const before = s - 2, after = s + 2
        const along = this.position(after, side, origin, height(after, side)).sub(this.position(before, side, origin, height(before, side)))
        const across = this.position(s, side + 2, origin, height(s, side + 2)).sub(this.position(s, side - 2, origin, height(s, side - 2)))
        const normal = across.cross(along).normalize()
        normals.push(normal.x, normal.y, normal.z)
        if (colorize) {
          const slope = Math.abs(height(s, side + 3) - height(s, side - 3)) / 6
          const color = grass.clone().lerp(dry, .2 + .15 * Math.sin(s / 90 + side / 61)).lerp(rock, Math.min(.8, slope * .8))
          if (this.profile === 'alpine') color.lerp(white, THREE.MathUtils.smoothstep(y, 145, 240))
          colors.push(color.r, color.g, color.b)
        }
      }
    }
    for (let r = 0; r < alongCells; r++) for (let c = 0; c < sideCells; c++) {
      const a = r * (sideCells + 1) + c, b = a + sideCells + 1
      indices.push(a, a + 1, b, a + 1, b + 1, b)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    if (colorize) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geometry.setIndex(indices)
    return geometry
  }

  private batch(tile: Tile, geometry: THREE.BufferGeometry, material: THREE.Material, transforms: THREE.Matrix4[], layer?: 'trees' | 'buildings') {
    if (!transforms.length) return
    const mesh = new THREE.InstancedMesh(geometry, material, transforms.length)
    transforms.forEach((matrix, index) => mesh.setMatrixAt(index, matrix))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    if (layer) { mesh.userData.layer = layer; mesh.visible = this.layers[layer] }
    tile.instances.push(mesh)
    tile.group.add(mesh)
  }

  private transform(position: THREE.Vector3, scale: THREE.Vector3, yaw = 0) {
    this.dummy.position.copy(position)
    this.dummy.scale.copy(scale)
    this.dummy.rotation.set(0, yaw, 0)
    this.dummy.updateMatrix()
    return this.dummy.matrix.clone()
  }

  private createTile(index: number): Tile {
    const start = index * TILE, end = Math.min(this.route.length, start + TILE)
    const origin = this.route.pose((start + end) / 2)
    const tile: Tile = { group: new THREE.Group(), origin, geometry: [], instances: [] }
    tile.group.name = `generated-network-tile-${index}`
    const addSurface = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
      tile.geometry.push(geometry)
      tile.group.add(new THREE.Mesh(geometry, material))
    }
    const sceneryStart = index === 0 ? start - END_SCENERY : start
    const sceneryEnd = end === this.route.length ? end + END_SCENERY : end
    // Only the outside edge of the first/last mesh expands, so no new surface
    // overlaps the neighbouring detailed tile. Tracks below stay source-bound.
    addSurface(this.surface(sceneryStart, sceneryEnd, -HALF_WIDTH, HALF_WIDTH, origin, (s, side) => this.terrain(s, side), true, 64), this.terrainMaterial)
    addSurface(this.surface(start, end, -2.6, 2.6, origin, s => this.elevation(s) + .02), this.ballastMaterial)
    for (const offset of [-.7175, .7175]) addSurface(this.surface(start, end, offset - .055, offset + .055, origin, s => this.elevation(s) + .19), this.railMaterial)
    if (this.profile === 'coast') addSurface(this.surface(sceneryStart, sceneryEnd, -SEA_WIDTH, -155, origin, () => .5, false, 3), this.waterMaterial)

    const ties: THREE.Matrix4[] = []
    for (let s = Math.ceil(start / 2.4) * 2.4; s < end; s += 2.4) {
      const pose = this.route.pose(s), p = this.position(s, 0, origin, this.elevation(s) + .08)
      ties.push(this.transform(p, new THREE.Vector3(2.5, .13, .24), Math.atan2(-pose.east, pose.north)))
    }
    this.batch(tile, this.houseGeometry, this.sleeperMaterial, ties)

    const trunks: THREE.Matrix4[] = [], leaves: THREE.Matrix4[] = [], cones: THREE.Matrix4[] = [], rocks: THREE.Matrix4[] = []
    const houses: THREE.Matrix4[] = [], roofs: THREE.Matrix4[] = []
    // Also reject props near another arm of a local hairpin, not just their own
    // sampled lateral offset. This is a bounded nearby route corridor query.
    const track: THREE.Vector3[] = []
    const low = Math.max(0, start - 1024), high = Math.min(this.route.length, end + 1024)
    for (const s of this.route.samples(low, high, 16)) track.push(this.position(s, 0, origin, 0))
    const clearTrack = (point: THREE.Vector3, clearance: number) => {
      for (let i = 1; i < track.length; i++) {
        const a = track[i - 1], b = track[i], dx = b.x - a.x, dz = b.z - a.z
        const t = THREE.MathUtils.clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / Math.max(.001, dx * dx + dz * dz), 0, 1)
        if ((point.x - a.x - t * dx) ** 2 + (point.z - a.z - t * dz) ** 2 < clearance ** 2) return false
      }
      return true
    }
    const cluster = random(index, 777) > .70 && this.profile !== 'alpine'
    const townSide = random(index, 778) > .5 ? 1 : -1
    const treeCount = this.profile === 'desert' ? 12 : this.profile === 'coast' ? 42 : 85
    for (let i = 0; i < treeCount; i++) {
      const seed = index * 193 + i, s = start + random(seed, 1) * (end - start)
      const side = (random(seed, 2) * 2 - 1) * 800
      if (Math.abs(side) < 18 || (cluster && Math.sign(side) === townSide && Math.abs(side) < 170)
        || (this.profile === 'coast' && side < -60)) continue
      const p = this.position(s, side, origin), size = 7 + random(seed, 3) * 10
      if (!clearTrack(p, 13)) continue
      if (this.profile === 'desert') {
        trunks.push(this.transform(p.clone().add(new THREE.Vector3(0, size * .22, 0)), new THREE.Vector3(1, size * .44, 1)))
        for (const direction of [-1, 1]) {
          const arm = p.clone().add(new THREE.Vector3(direction * .8, size * .26, 0))
          trunks.push(this.transform(arm, new THREE.Vector3(.65, size * .24, .65)))
        }
      } else {
        trunks.push(this.transform(p.clone().add(new THREE.Vector3(0, size * .35, 0)), new THREE.Vector3(1, size * .7, 1)))
        const conifer = this.profile === 'alpine' || random(seed, 5) > .64
        if (conifer) {
          for (let crown = 0; crown < 3; crown++) cones.push(this.transform(p.clone().add(new THREE.Vector3(0, size * (.42 + crown * .2), 0)),
            new THREE.Vector3(size * (.32 - crown * .07), size * .48, size * (.32 - crown * .07))))
        } else {
          for (let crown = 0; crown < 3; crown++) leaves.push(this.transform(p.clone().add(new THREE.Vector3(Math.sin(crown * 2.1) * size * .15, size * (.64 + crown * .08), Math.cos(crown * 2.1) * size * .15)),
            new THREE.Vector3(size * .31, size * .28, size * .3), random(seed, crown + 8) * Math.PI))
        }
      }
    }
    for (let i = 0; i < 28; i++) {
      const seed = index * 97 + i, s = start + random(seed, 31) * (end - start), side = (random(seed, 32) * 2 - 1) * 700
      if (Math.abs(side) < 9 || (this.profile === 'coast' && side < -65)) continue
      const size = 1 + random(seed, 33) * (this.profile === 'desert' ? 6 : 3)
      const p = this.position(s, side, origin)
      if (!clearTrack(p, 10)) continue
      rocks.push(this.transform(p.add(new THREE.Vector3(0, size * .25, 0)), new THREE.Vector3(size, size * .6, size * .8), random(seed, 34) * 6))
    }
    if (cluster) for (let i = 0; i < 7; i++) {
      const s = start + (i + .5) * (end - start) / 7, side = townSide * (65 + random(index * 17 + i, 70) * 45)
      if (this.profile === 'coast' && side < 0) continue
      const p = this.position(s, side, origin), h = 5 + random(index * 17 + i, 71) * 4, w = 8 + random(index * 17 + i, 72) * 5
      if (!clearTrack(p, 22)) continue
      const pose = this.route.pose(s), yaw = Math.atan2(-pose.east, pose.north)
      houses.push(this.transform(p.clone().add(new THREE.Vector3(0, h / 2, 0)), new THREE.Vector3(w, h, 9), yaw))
      roofs.push(this.transform(p.clone().add(new THREE.Vector3(0, h + 1.5, 0)), new THREE.Vector3(w * .84, 3, 7), yaw))
    }
    this.batch(tile, this.trunkGeometry, this.trunkMaterial, trunks, 'trees')
    this.batch(tile, this.leafGeometry, this.leafMaterial, leaves, 'trees')
    this.batch(tile, this.coneGeometry, this.leafMaterial, cones, 'trees')
    this.batch(tile, this.rockGeometry, this.rockMaterial, rocks)
    this.batch(tile, this.houseGeometry, this.wallMaterial, houses, 'buildings')
    this.batch(tile, this.roofGeometry, this.roofMaterial, roofs, 'buildings')
    return tile
  }

  private releaseTile(tile: Tile) {
    tile.group.removeFromParent()
    tile.instances.forEach(mesh => mesh.dispose())
    tile.geometry.forEach(geometry => geometry.dispose())
    tile.group.clear()
  }

  private updateTiles() {
    const index = Math.min(Math.floor(this.distance / TILE), Math.max(0, Math.ceil(this.route.length / TILE) - 1))
    // Sideways landscape views need longitudinal terrain on BOTH sides of the
    // eye. Cover the horizontal FOV at the corridor edge, plus a tile margin.
    const halfFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(60) / 2) * this.camera.aspect)
    const radius = Math.min(MAX_TILE_RADIUS, Math.max(6, Math.ceil((HALF_WIDTH * Math.tan(halfFov) + TILE) / TILE)))
    if (index === this.anchorIndex && radius === this.tileRadius) return
    this.anchorIndex = index
    this.tileRadius = radius
    this.origin = this.route.pose(this.distance)
    const wanted = new Set<number>()
    const lastIndex = Math.ceil(this.route.length / TILE) - 1
    // Balanced side-window coverage plus forward prefetch; hard maximum 17.
    for (let delta = -radius; delta <= radius; delta++) {
      const key = index + delta
      if (key >= 0 && key <= lastIndex) wanted.add(key)
    }
    for (const [key, tile] of this.tiles) if (!wanted.has(key)) { this.releaseTile(tile); this.tiles.delete(key) }
    for (const key of wanted) if (!this.tiles.has(key)) {
      const tile = this.createTile(key)
      this.tiles.set(key, tile)
      this.scene.add(tile.group)
    }
    for (const tile of this.tiles.values()) {
      const p = this.route.project(tile.origin, this.origin)
      tile.group.position.set(p.x, 0, p.z)
      const scale = Math.cos(this.origin.latitude * Math.PI / 180) / Math.max(.00001, Math.cos(tile.origin.latitude * Math.PI / 180))
      tile.group.scale.set(scale, 1, scale)
    }
  }

  private render() {
    if (this.contextLost || this.container.clientWidth === 0 || this.container.clientHeight === 0) return false
    const pose = this.route.pose(this.distance), p = this.route.project(pose, this.origin), y = this.elevation(this.distance)
    const position = new THREE.Vector3(p.x, y + 2.4, p.z)
    const forward = new THREE.Vector3(pose.east, 0, -pose.north)
    const side = new THREE.Vector3(pose.north, 0, pose.east).multiplyScalar(this.profile === 'coast' ? -1 : 1)
    const target = position.clone()
    if (this.overview) {
      this.camera.position.copy(position).addScaledVector(side, 540).add(new THREE.Vector3(0, 850, 250))
      this.camera.lookAt(target)
      this.camera.fov = 52
    } else {
      this.camera.position.copy(position)
      const direction = side.clone().multiplyScalar(Math.cos(this.yaw)).addScaledVector(forward, Math.sin(this.yaw))
      target.addScaledVector(direction, 180).add(new THREE.Vector3(0, 4 + Math.sin(this.pitch) * 150, 0))
      this.camera.lookAt(target)
      this.camera.fov = 60
    }
    this.camera.updateProjectionMatrix()
    this.sun.position.copy(position).add(new THREE.Vector3(-700, 1100, 450))
    this.sun.target.position.copy(position)
    this.renderer.info.reset()
    this.renderer.render(this.scene, this.camera)
    return true
  }

  private report(now: number, force = false) {
    if (this.disposed || (!force && now - this.lastTelemetry < 250)) return
    this.lastTelemetry = now
    const pose = this.route.pose(this.distance), info = this.renderer.info.render
    this.onTelemetry({ distanceMetres: this.distance, lengthMetres: this.route.length, longitude: pose.longitude, latitude: pose.latitude,
      speedKmh: this.paused || !this.ready || this.overview || document.hidden ? 0 : this.speed, paused: this.paused,
      ready: this.ready, tiles: this.tiles.size, drawCalls: info.calls, triangles: info.triangles, frameMs: this.lastFrameMs, error: this.renderError })
  }

  private animate = (now: number) => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.animate)
    if (document.hidden || this.contextLost || this.renderError) { this.lastTime = 0; return }
    const elapsed = this.lastTime ? Math.max(0, now - this.lastTime) : 0
    this.lastTime = now
    this.lastFrameMs = elapsed
    try {
      if (!this.paused && this.ready && !this.overview) {
        this.distance = Math.min(this.route.length, this.distance + this.speed / 3.6 * Math.min(elapsed / 1000, .25))
        if (this.distance >= this.route.length) this.paused = true
        this.updateTiles()
      }
      if (this.render()) this.ready = true
    } catch (error) {
      this.renderError = error instanceof Error ? error.message : String(error)
      this.ready = false
      this.paused = true
      this.renderer.domElement.dataset.error = this.renderError
    }
    this.report(now)
  }

  private resize = () => {
    if (this.disposed) return
    const width = Math.max(1, this.container.clientWidth), height = Math.max(1, this.container.clientHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 700 ? 1.25 : 1.5))
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.lastTime = 0
    if (this.tiles.size) this.updateTiles()
  }

  private visibilityChanged = () => { this.lastTime = 0 }
  private onContextLost = (event: Event) => {
    event.preventDefault()
    this.contextLost = true
    this.renderError = 'WebGL 上下文丢失，请重新打开路线'
    this.ready = false
    this.paused = true
    this.report(performance.now(), true)
  }
  private pointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || this.overview) return
    this.pointer = event.pointerId
    this.pointerX = event.clientX; this.pointerY = event.clientY
    this.renderer.domElement.setPointerCapture(event.pointerId)
  }
  private pointerMove = (event: PointerEvent) => {
    if (this.pointer !== event.pointerId) return
    this.yaw = THREE.MathUtils.clamp(this.yaw + (event.clientX - this.pointerX) * .004, -1.2, 1.2)
    this.pitch = THREE.MathUtils.clamp(this.pitch + (event.clientY - this.pointerY) * .003, -.5, .5)
    this.pointerX = event.clientX; this.pointerY = event.clientY
  }
  private pointerUp = (event: PointerEvent) => {
    if (this.pointer !== event.pointerId) return
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId)
    this.pointer = null
  }
  private resetView = () => { this.yaw = 0; this.pitch = 0 }

  setPaused(paused: boolean) {
    if (this.disposed) return
    this.paused = paused
    this.lastTime = 0
    this.report(performance.now(), true)
  }
  setSpeed(kmh: number) {
    if (!Number.isFinite(kmh)) throw new TypeError('速度必须是有限数值')
    if (this.disposed) return
    this.speed = THREE.MathUtils.clamp(kmh, 0, 180)
    this.report(performance.now(), true)
  }
  seek(metres: number) {
    if (!Number.isFinite(metres)) throw new TypeError('里程必须是有限数值')
    if (this.disposed) return
    this.distance = THREE.MathUtils.clamp(metres, 0, this.route.length)
    if (this.distance === this.route.length) this.paused = true
    this.lastTime = 0
    this.updateTiles()
    if (this.render()) this.ready = true
    this.report(performance.now(), true)
  }
  setOverview(overview: boolean) {
    if (this.disposed) return
    this.overview = overview
    this.lastTime = 0
    this.report(performance.now(), true)
  }
  setLayers(layers: { trees: boolean; buildings: boolean }) {
    if (this.disposed) return
    this.layers = { ...layers }
    for (const tile of this.tiles.values()) for (const mesh of tile.instances) {
      const layer = mesh.userData.layer as 'trees' | 'buildings' | undefined
      if (layer) mesh.visible = this.layers[layer]
    }
  }
  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.observer.disconnect()
    document.removeEventListener('visibilitychange', this.visibilityChanged)
    const canvas = this.renderer.domElement
    canvas.removeEventListener('pointerdown', this.pointerDown)
    canvas.removeEventListener('pointermove', this.pointerMove)
    canvas.removeEventListener('pointerup', this.pointerUp)
    canvas.removeEventListener('pointercancel', this.pointerUp)
    canvas.removeEventListener('dblclick', this.resetView)
    canvas.removeEventListener('webglcontextlost', this.onContextLost)
    for (const tile of this.tiles.values()) this.releaseTile(tile)
    this.tiles.clear()
    this.sharedGeometry.forEach(geometry => geometry.dispose())
    this.materials.forEach(material => material.dispose())
    this.scene.clear()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    canvas.remove()
  }
}
