import * as THREE from 'three'
import { createSeededRandom, hash01 } from '../core/procedural'
import { CHUNK_SIZE } from './DecorationPlacement'
import { trackElevationAt } from './RouteProfile'
import { waterChannelAt, riverWaterElevationAt } from './TerrainGen'
import { landscapeAt } from './Landscape'
import type { RoutePlan } from './RouteFeatures'
import type { PatchSettings } from './TerrainEdits'
import { SceneryAssets, type SceneryAsset, type SceneryPlacement } from './SceneryAssets'

/** The same parcel layout and cached models serve the map and passenger view.
 * Road access, dry ground and foundation slope are checked before placement. */
export function createPatchScenery(cx: number, cz: number, settings: PatchSettings, heightAt: (x: number, z: number) => number, assets: SceneryAssets, plan: RoutePlan, edited: boolean, mapView: boolean): THREE.Group {
  const group = new THREE.Group(), vegetation = new THREE.Group(), settlement = new THREE.Group(), farmland = new THREE.Group(), water = new THREE.Group()
  vegetation.userData.landscapeLayer = 'vegetation'; settlement.userData.landscapeLayer = 'settlement'
  farmland.userData.landscapeLayer = 'farmland'; water.userData.landscapeLayer = 'water'
  group.add(vegetation, settlement, farmland, water)
  const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE, x = x0 + 128, z = z0 + 128
  const random = createSeededRandom(settings.seed)
  const batches = new Map<SceneryAsset, SceneryPlacement[]>()
  const inhabited = ['city', 'town', 'village'].includes(settings.scene)
  const city = settings.scene === 'city', town = settings.scene === 'town'
  const slope = (wx: number, wz: number) => Math.hypot(heightAt(wx + 2, wz) - heightAt(wx - 2, wz), heightAt(wx, wz + 2) - heightAt(wx, wz - 2)) / 4
  const wet = (wx: number, wz: number) => {
    if (settings.scene !== 'valley') return false
    const channel = edited ? x + Math.sin(wz * 0.013) * 9 : waterChannelAt(wz, plan).centerX
    return Math.abs(wx - channel) < 20 && heightAt(wx, wz) < trackElevationAt(wz) - 0.8
  }
  const add = (asset: SceneryAsset, wx: number, wz: number, h: number, yaw: number, building = false) => {
    const footprint = assets.footprint(asset, h)
    const radius = building ? Math.max(footprint.width, footprint.depth) * 0.5 : 4
    if (wx - radius < Math.max(28, x0 + 5) || wx + radius > x0 + 251 || wz - radius < z0 + 5 || wz + radius > z0 + 251 || wet(wx, wz)) return
    const samples = [heightAt(wx, wz), ...[-1, 1].flatMap(dx => [-1, 1].map(dz => heightAt(wx + dx * radius, wz + dz * radius)))]
    if (building && Math.max(...samples) - Math.min(...samples) > 1.1 || !building && slope(wx, wz) > 0.7) return
    const values = batches.get(asset) ?? []
    values.push({ x: wx, y: building ? Math.min(...samples) - 0.12 : samples[0] - 0.1, z: wz, height: h, yaw })
    batches.set(asset, values)
  }
  const surface = (parent: THREE.Group, wx: number, wz: number, width: number, length: number, material: THREE.Material) => {
    if (parent === settlement && wx - width / 2 < 28) {
      const right = wx + width / 2; width = Math.max(0, right - 28); wx = (right + 28) / 2
    }
    if (width <= 0 || parent === settlement && slope(wx, wz) > 0.2) { material.dispose(); return }
    const geom = new THREE.PlaneGeometry(width, length, Math.max(1, Math.ceil(width / 4)), Math.max(1, Math.ceil(length / 4)))
    geom.rotateX(-Math.PI / 2)
    const points = geom.attributes.position
    for (let i = 0; i < points.count; i++) points.setY(i, heightAt(wx + points.getX(i), wz + points.getZ(i)) + 0.08)
    geom.computeVertexNormals()
    const mesh = new THREE.Mesh(geom, material); mesh.position.set(wx, 0, wz); mesh.receiveShadow = true; parent.add(mesh)
  }
  if (inhabited) {
    const road = () => new THREE.MeshStandardMaterial({ color: city || town ? 0x747570 : 0xa3977a, roughness: 1 })
    // Roads meet at chunk boundaries. Every building faces a road; parcels
    // occupy the gaps between streets instead of scattering boxes at random.
    for (const offset of city ? [64, 128, 192] : [128]) surface(settlement, x0 + offset, z, city ? 6 : 5, 256, road())
    if (city || town) for (const offset of [64, 128, 192]) surface(settlement, x, z0 + offset, 256, 5, road())
    else for (const offset of [64, 192]) surface(settlement, x, z0 + offset, 256, 3, road())
    // Link the first village/town avenue with the existing lineside road.
    if (cx === 0) surface(settlement, 74, z0 + 64, 108, 3, road())
    const rows = city ? [40, 96, 160, 224] : [32, 96, 160, 224]
    const columns = city ? [40, 96, 160, 224] : [101, 155]
    for (const col of columns) for (const row of rows) {
      const roll = random(), asset: SceneryAsset = city && roll > 0.55 ? (roll > 0.85 ? 'towerA' : roll > 0.7 ? 'towerB' : 'towerC')
        : (city || town && roll > 0.5) ? (roll > 0.65 ? 'lowriseA' : roll > 0.3 ? 'lowriseB' : 'lowriseC')
        : (roll > 0.65 ? 'houseA' : roll > 0.3 ? 'houseB' : 'houseC')
      const h = asset.startsWith('tower') ? 27 + random() * 16 : asset.startsWith('lowrise') ? 11 + random() * 7 : 6 + random() * 3
      {
        const wx = x0 + col, wz = z0 + row
        const padSize = city ? 45 : town ? 27 : 16
        // Paved plots and driveways join buildings to their facing street.
        if (slope(wx, wz) < 0.1) {
          surface(settlement, wx, wz, padSize, padSize, new THREE.MeshStandardMaterial({ color: city || town ? 0xa5a69a : 0xa9a18b, roughness: 1 }))
          const streetX = x0 + (city ? [64, 128, 192].reduce((a, b) => Math.abs(b - col) < Math.abs(a - col) ? b : a) : 128)
          surface(settlement, (wx + streetX) / 2, wz, Math.abs(streetX - wx), 3, road())
        }
      }
      add(asset, x0 + col, z0 + row, h, col < 128 ? Math.PI / 2 : -Math.PI / 2, true)
    }
  }
  if (settings.scene === 'field') {
    for (const col of [80, 136, 192]) for (const row of [40, 96, 152, 208]) {
      const wx = x0 + col, wz = z0 + row
      if (slope(wx, wz) > 0.1 || wet(wx, wz)) continue
      const material = new THREE.MeshStandardMaterial({ color: [0x979457, 0x76894b, 0xa0a56b, 0x8a7454][Math.floor(random() * 4)], roughness: 1 })
      surface(farmland, wx, wz, 48, 48, material)
      // Small furrows read at middle distance; close corn is instanced.
      const furrows = new THREE.BufferGeometry(), vertices: number[] = []
      for (let off = -20; off <= 20; off += 4) for (let l = -24; l < 24; l += 4) vertices.push(wx + off, heightAt(wx + off, wz + l) + 0.12, wz + l, wx + off, heightAt(wx + off, wz + l + 4) + 0.12, wz + l + 4)
      furrows.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
      farmland.add(new THREE.LineSegments(furrows, new THREE.LineBasicMaterial({ color: 0x627447, transparent: true, opacity: 0.45 })))
      if (cx === 0 && col === 80) for (let off = -20; off < 20; off += 5) for (let l = -20; l < 20; l += 5) add('corn', wx + off, wz + l, 1.4 + random() * 0.2, 0)
    }
  }
  if (settings.scene === 'valley' && (edited || mapView)) {
    const vertices: number[] = []
    for (let row = 0; row < 64; row++) {
      const za = z0 + row * 4, zb = za + 4
      const xa = edited ? x + Math.sin(za * 0.013) * 9 : waterChannelAt(za, plan).centerX
      const xb = edited ? x + Math.sin(zb * 0.013) * 9 : waterChannelAt(zb, plan).centerX
      const ya = edited ? trackElevationAt(za) - 0.85 : riverWaterElevationAt(za, landscapeAt(za, plan).params.river)
      const yb = edited ? trackElevationAt(zb) - 0.85 : riverWaterElevationAt(zb, landscapeAt(zb, plan).params.river)
      if (xa < x0 + 14 || xa > x0 + 242 || heightAt(xa, za) > ya - 0.1 || heightAt(xb, zb) > yb - 0.1) continue
      const wa = Math.min(edited ? 9 : waterChannelAt(za, plan).halfWidth, (ya - heightAt(xa, za)) * 5), wb = Math.min(edited ? 9 : waterChannelAt(zb, plan).halfWidth, (yb - heightAt(xb, zb)) * 5)
      vertices.push(xa - wa, ya, za, xb - wb, yb, zb, xa + wa, ya, za, xa + wa, ya, za, xb - wb, yb, zb, xb + wb, yb, zb)
    }
    const geom = new THREE.BufferGeometry(); geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geom.computeVertexNormals()
    water.add(new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0x54878a, roughness: 0.3, side: THREE.DoubleSide })))
  }
  const attempts = settings.scene === 'forest' ? 180 : settings.scene === 'mountain' ? 36 : inhabited ? 22 : settings.scene === 'field' ? 22 : 65
  for (let i = 0; i < attempts; i++) {
    const wx = x0 + 12 + random() * 232, wz = z0 + 12 + random() * 232
    if (inhabited && (Math.abs(wx - x) < 60 || city) || settings.scene === 'field' && wx > x0 + 52 && wx < x0 + 220) continue
    // Broad clusters and clearings, deterministic in world coordinates.
    if (hash01(Math.floor(wx / 42), Math.floor(wz / 42) + settings.seed) < 0.22) continue
    const asset: SceneryAsset = settings.scene === 'mountain' ? (random() > 0.5 ? 'pine' : 'tallPine') : random() > 0.4 ? 'broadleaf' : 'oak'
    add(asset, wx, wz, 8 + random() * 8, random() * Math.PI * 2)
  }
  if (['mountain', 'valley'].includes(settings.scene)) for (let i = 0; i < 28; i++) {
    const wx = x0 + 20 + random() * 216, wz = z0 + 20 + random() * 216
    if (slope(wx, wz) < 0.25) continue
    add(random() > 0.5 ? 'rock' : 'boulder', wx, wz, 1.2 + random() * 2.4, random() * Math.PI * 2)
  }
  for (const [asset, placements] of batches) assets.addInstances(asset === 'corn' ? farmland : /house|lowrise|tower/.test(asset) ? settlement : vegetation, asset, placements)
  return group
}
