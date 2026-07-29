import * as THREE from 'three'
import type { RandomSource } from '../core/procedural'
import {
  farBankRoadCenterX,
  RIVER_HALF_WIDTH,
  riverCenterX,
  riverWaterElevationAt,
} from './TerrainGen'

/** European-style building factories + town cluster generator.
 *  All textures are canvas-generated; no external assets.
 *  Every group is returned with its origin at base center. */

const WALL_COLORS = [0xcfc0a8, 0xbfa890, 0xd8cbb0, 0xb09878, 0xc8b498, 0xa89880]
const ROOF_COLORS = [0x8a4a3a, 0x6a5a52, 0x7a3a2a, 0x4a4a52, 0x94553e]
const APARTMENT_COLORS = [0xc8b8a0, 0xb8a890, 0xa89888, 0xd0c0a8]

type HeightSampler = (x: number, z: number) => number

function pick<T>(arr: T[], random: RandomSource): T {
  return arr[Math.floor(random() * arr.length)]
}

/** Gabled roof: triangular prism via ExtrudeGeometry, ridge along local Z. */
function makeGableRoof(w: number, d: number, h: number, mat: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape()
  shape.moveTo(-w / 2 - 0.15, 0)
  shape.lineTo(w / 2 + 0.15, 0)
  shape.lineTo(0, h)
  shape.closePath()
  const geom = new THREE.ExtrudeGeometry(shape, { depth: d + 0.3, bevelEnabled: false })
  geom.translate(0, 0, -(d + 0.3) / 2)
  const roof = new THREE.Mesh(geom, mat)
  roof.castShadow = true
  return roof
}

/** Window with frame + sill, slightly proud of the wall. Faces +Z. */
function makeWindow(w: number, h: number, frameMat: THREE.Material, glassMat: THREE.Material): THREE.Group {
  const win = new THREE.Group()
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.05), frameMat)
  win.add(frame)
  const glass = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), glassMat)
  win.add(glass)
  const sill = new THREE.Mesh(new THREE.BoxGeometry(w + 0.14, 0.05, 0.09), frameMat)
  sill.position.y = -h / 2 - 0.04
  win.add(sill)
  return win
}

/** Detached European house: plastered walls, gabled roof, chimney,
 *  framed windows on both gable-facing sides, door. */
export function createHouse(random: RandomSource = Math.random): THREE.Group {
  const bldg = new THREE.Group()
  const w = 3 + random() * 1.6
  const d = 2.6 + random() * 1.2
  const h = 2 + random() * 0.7

  const wallMat = new THREE.MeshStandardMaterial({ color: pick(WALL_COLORS, random), roughness: 0.9 })
  const roofMat = new THREE.MeshStandardMaterial({
    color: pick(ROOF_COLORS, random), roughness: 0.85, flatShading: true,
  })
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xf0ead8, roughness: 0.8 })
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x2a3a4a, roughness: 0.2, metalness: 0.3,
    emissive: 0xffdd88, emissiveIntensity: 0.25,
  })

  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat)
  walls.position.y = h / 2
  walls.castShadow = true
  bldg.add(walls)

  const roofH = h * 0.55 + 0.4
  const roof = makeGableRoof(w, d, roofH, roofMat)
  roof.position.y = h
  bldg.add(roof)

  // Chimney
  const chimney = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.8, 0.28),
    new THREE.MeshStandardMaterial({ color: 0x8a6a58, roughness: 0.9 })
  )
  chimney.position.set(w * 0.25, h + roofH * 0.6, d * 0.2)
  chimney.castShadow = true
  bldg.add(chimney)

  // Windows on the long sides
  const floors = h > 2.3 ? 2 : 1
  for (const side of [-1, 1]) {
    for (let f = 0; f < floors; f++) {
      const wy = 0.75 + f * 1.1
      for (const off of [-w * 0.25, w * 0.25]) {
        const win = makeWindow(0.4, 0.55, trimMat, glassMat)
        win.position.set(off, wy, side * (d / 2 + 0.01))
        if (side < 0) win.rotation.y = Math.PI
        bldg.add(win)
      }
    }
  }

  // Door
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.95, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.85 })
  )
  door.position.set(0, 0.48, d / 2 + 0.02)
  bldg.add(door)

  return bldg
}

/** Window-grid texture pair for apartment blocks: `map` is the wall with
 *  window openings, `lit` is the emissive layer where a few windows glow. */
function makeApartmentTextures(
  cols: number,
  rows: number,
  wallColor: string,
  random: RandomSource,
): { map: THREE.Texture; lit: THREE.Texture } {
  const wpx = 64 * cols
  const hpx = 64 * rows
  const dayCanvas = document.createElement('canvas')
  dayCanvas.width = wpx
  dayCanvas.height = hpx
  const nightCanvas = document.createElement('canvas')
  nightCanvas.width = wpx
  nightCanvas.height = hpx
  const dctx = dayCanvas.getContext('2d')!
  const nctx = nightCanvas.getContext('2d')!

  dctx.fillStyle = wallColor
  dctx.fillRect(0, 0, wpx, hpx)
  nctx.fillStyle = '#000000'
  nctx.fillRect(0, 0, wpx, hpx)

  const cw = wpx / cols
  const ch = hpx / rows
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw + cw * 0.25
      const y = r * ch + ch * 0.22
      const ww = cw * 0.5
      const wh = ch * 0.56
      // Frame
      dctx.fillStyle = '#e8e2d2'
      dctx.fillRect(x - 3, y - 3, ww + 6, wh + 6)
      // Glass: mostly dark reflective, some interior-lit
      const litUp = random() < 0.28
      dctx.fillStyle = litUp ? '#f5d98a' : '#26313e'
      dctx.fillRect(x, y, ww, wh)
      // Mullion cross
      dctx.fillStyle = litUp ? '#c8ae6a' : '#48525e'
      dctx.fillRect(x + ww / 2 - 1, y, 2, wh)
      dctx.fillRect(x, y + wh / 2 - 1, ww, 2)
      if (litUp) {
        nctx.fillStyle = '#ffd98a'
        nctx.fillRect(x, y, ww, wh)
        nctx.fillStyle = '#e8b86a'
        nctx.fillRect(x + ww / 2 - 1, y, 2, wh)
      }
      // Sill shadow
      dctx.fillStyle = 'rgba(0,0,0,0.18)'
      dctx.fillRect(x - 3, y + wh + 3, ww + 6, 3)
    }
  }

  const map = new THREE.CanvasTexture(dayCanvas)
  map.colorSpace = THREE.SRGBColorSpace
  const lit = new THREE.CanvasTexture(nightCanvas)
  lit.colorSpace = THREE.SRGBColorSpace
  return { map, lit }
}

/** Mid-rise apartment block: 3-5 storeys, window-grid facade, flat roof rim. */
export function createApartment(random: RandomSource = Math.random): THREE.Group {
  const bldg = new THREE.Group()
  const floors = 3 + Math.floor(random() * 3)
  const w = 7 + random() * 3
  const d = 6 + random() * 2
  const h = floors * 1.6

  const cols = Math.max(4, Math.round(w / 1.4))
  const wallHex = pick(APARTMENT_COLORS, random)
  const { map, lit } = makeApartmentTextures(
    cols,
    floors,
    `#${wallHex.toString(16).padStart(6, '0')}`,
    random,
  )
  const wallMat = new THREE.MeshStandardMaterial({
    map,
    emissiveMap: lit,
    emissive: 0xffffff,
    emissiveIntensity: 0.55,
    roughness: 0.9,
  })

  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat)
  body.position.y = h / 2
  body.castShadow = true
  bldg.add(body)

  // Flat roof with a slight rim
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x6a655c, roughness: 0.95 })
  const rim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.25, d + 0.3), rimMat)
  rim.position.y = h + 0.1
  bldg.add(rim)

  // Ground-floor shop band with awning
  if (random() < 0.6) {
    const shop = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.9, 0.9, 0.15),
      new THREE.MeshStandardMaterial({
        color: 0x2a3a4a, roughness: 0.3, metalness: 0.2,
        emissive: 0xffeebb, emissiveIntensity: 0.15,
      })
    )
    shop.position.set(0, 0.8, d / 2 + 0.08)
    bldg.add(shop)
    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.9, 0.08, 0.6),
      new THREE.MeshStandardMaterial({ color: pick([0x9a3a32, 0x3a5a4a, 0x3a4a6a], random), roughness: 0.8 })
    )
    awning.position.set(0, 1.4, d / 2 + 0.35)
    awning.rotation.x = 0.25
    bldg.add(awning)
  }

  return bldg
}

/** Small town church: nave + bell tower + pyramid spire. */
export function createChurch(): THREE.Group {
  const church = new THREE.Group()
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xcabfa5, roughness: 0.95 })
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a4a52, roughness: 0.85, flatShading: true })
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x3a2a4a, roughness: 0.3,
    emissive: 0xaa88dd, emissiveIntensity: 0.3,
  })

  // Nave
  const naveW = 4.5, naveD = 7, naveH = 3.2
  const nave = new THREE.Mesh(new THREE.BoxGeometry(naveW, naveH, naveD), stoneMat)
  nave.position.y = naveH / 2
  nave.castShadow = true
  church.add(nave)
  const naveRoof = makeGableRoof(naveW, naveD, 1.8, roofMat)
  naveRoof.position.y = naveH
  church.add(naveRoof)

  // Bell tower
  const towerW = 1.8, towerH = 7.5
  const tower = new THREE.Mesh(new THREE.BoxGeometry(towerW, towerH, towerW), stoneMat)
  tower.position.set(0, towerH / 2, naveD / 2 + towerW / 2 - 0.2)
  tower.castShadow = true
  church.add(tower)

  // Spire
  const spire = new THREE.Mesh(new THREE.ConeGeometry(towerW * 0.85, 2.6, 4), roofMat)
  spire.position.set(0, towerH + 1.3, naveD / 2 + towerW / 2 - 0.2)
  spire.rotation.y = Math.PI / 4
  spire.castShadow = true
  church.add(spire)

  // Belfry openings (dark arches) + clock face
  for (const side of [-1, 1]) {
    const arch = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.06), glassMat)
    arch.position.set(side * 0.4, towerH - 1.2, naveD / 2 + towerW - 0.16)
    church.add(arch)
  }
  const clock = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.42, 0.06, 16),
    new THREE.MeshStandardMaterial({ color: 0xf0ead8, roughness: 0.6 })
  )
  clock.rotation.x = Math.PI / 2
  clock.position.set(0, towerH - 2.6, naveD / 2 + towerW - 0.16)
  church.add(clock)

  // Nave side windows (tall arched)
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.4, 0.45), glassMat)
      win.position.set(side * (naveW / 2 + 0.01), 1.8, -naveD / 2 + 1.2 + i * 2.2)
      church.add(win)
    }
  }

  return church
}

/** A small town: buildings arranged along a main street parallel to the
 *  track (+Z), with a couple of side streets. 8-14 buildings: mostly houses,
 *  some apartment blocks near the centre, optionally a church. */
export function createTownCluster(
  cx: number,
  cz: number,
  sampleHeight: HeightSampler,
  random: RandomSource = Math.random,
): THREE.Group {
  const town = new THREE.Group()

  const houseCount = 8 + Math.floor(random() * 4)
  const aptCount = 2 + Math.floor(random() * 3)
  const hasChurch = random() < 0.5

  const placed: { x: number; z: number; r: number }[] = []
  const tryPlace = (make: () => THREE.Group, r: number, xMin: number, xMax: number) => {
    for (let attempt = 0; attempt < 12; attempt++) {
      // Keep the rail-side verge open. Homes face the road from the far side.
      const x = cx + xMin + random() * (xMax - xMin)
      const z = cz + (random() - 0.5) * 170
      let clear = true
      for (const p of placed) {
        const dx = p.x - x
        const dz = p.z - z
        if (Math.sqrt(dx * dx + dz * dz) < p.r + r + 2) { clear = false; break }
      }
      if (!clear) continue
      const b = make()
      b.position.set(x, sampleHeight(x, z) - 0.15, z)
      b.rotation.y = Math.PI + (random() - 0.5) * 0.22
      town.add(b)
      placed.push({ x, z, r })
      return
    }
  }

  for (let i = 0; i < houseCount; i++) tryPlace(() => createHouse(random), 3.2, 10, 38)
  for (let i = 0; i < aptCount; i++) tryPlace(() => createApartment(random), 5.5, 10, 24)
  if (hasChurch) tryPlace(createChurch, 6, 8, 20)

  // Main street: paved strip parallel to the track through the town centre
  const streetMat = new THREE.MeshStandardMaterial({ color: 0x55524c, roughness: 0.95 })
  const streetGeom = new THREE.PlaneGeometry(4, 190, 1, 24)
  streetGeom.rotateX(-Math.PI / 2)
  const pos = streetGeom.attributes.position.array as Float32Array
  for (let i = 0; i < pos.length; i += 3) {
    const wx = cx + pos[i]
    const wz = cz + pos[i + 2]
    pos[i + 1] = sampleHeight(wx, wz) + 0.06
  }
  streetGeom.computeVertexNormals()
  const street = new THREE.Mesh(streetGeom, streetMat)
  street.position.set(cx, 0, cz)
  street.receiveShadow = true
  town.add(street)

  // Side streets connect the main road with homes instead of leaving them
  // scattered over grass. Their surfaces conform to the same terrain sampler.
  for (let i = 0; i < 3; i++) {
    const z = cz - 54 + i * 54
    const length = 28 + random() * 12
    const laneGeom = new THREE.PlaneGeometry(length, 2.7, 6, 1)
    laneGeom.rotateX(-Math.PI / 2)
    const lanePos = laneGeom.attributes.position.array as Float32Array
    for (let v = 0; v < lanePos.length; v += 3) {
      const wx = cx + length / 2 + lanePos[v]
      const wz = z + lanePos[v + 2]
      lanePos[v] = wx
      lanePos[v + 1] = sampleHeight(wx, wz) + 0.075
      lanePos[v + 2] = wz
    }
    laneGeom.computeVertexNormals()
    const lane = new THREE.Mesh(laneGeom, streetMat)
    lane.receiveShadow = true
    town.add(lane)
  }

  // Street lamps along the main street
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.5, metalness: 0.6 })
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xffeecc, emissive: 0xffdd99, emissiveIntensity: 0.9, roughness: 0.3,
  })
  for (let i = 0; i < 6; i++) {
    const lamp = new THREE.Group()
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 3.4, 6), lampMat)
    pole.position.y = 1.7
    lamp.add(pole)
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), bulbMat)
    bulb.position.y = 3.45
    lamp.add(bulb)
    const lx = cx + (i % 2 === 0 ? -2.6 : 2.6)
    const lz = cz - 80 + i * 32
    lamp.position.set(lx, sampleHeight(lx, lz), lz)
    town.add(lamp)
  }

  return town
}

/**
 * A deliberately small settlement on the far river bank. The bridge and its
 * access road are fixed route features; this cluster gives those works a
 * reason to exist without turning the whole valley into another town biome.
 */
export function createRiverVillage(
  bridgeZ: number,
  villageZ: number,
  sampleHeight: HeightSampler,
  random: RandomSource = Math.random,
): THREE.Group {
  const village = new THREE.Group()
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x57534e, roughness: 0.94 })
  const gravelMat = new THREE.MeshStandardMaterial({ color: 0x898075, roughness: 0.98 })
  const timberMat = new THREE.MeshStandardMaterial({ color: 0x70513b, roughness: 0.9 })
  const boatMat = new THREE.MeshStandardMaterial({ color: 0x425e72, roughness: 0.62, metalness: 0.12 })

  const addLongitudinalRoad = () => {
    const startZ = bridgeZ - 2
    const endZ = villageZ + 118
    const length = endZ - startZ
    const geometry = new THREE.PlaneGeometry(3.8, length, 1, Math.ceil(length / 8))
    geometry.rotateX(-Math.PI / 2)
    const positions = geometry.attributes.position.array as Float32Array
    for (let i = 0; i < positions.length; i += 3) {
      const z = startZ + positions[i + 2] + length / 2
      const x = farBankRoadCenterX(z) + positions[i]
      positions[i] = x
      positions[i + 1] = sampleHeight(x, z) + 0.075
      positions[i + 2] = z
    }
    geometry.computeVertexNormals()
    const road = new THREE.Mesh(geometry, roadMat)
    road.receiveShadow = true
    village.add(road)
  }

  const addBridgeSpur = () => {
    const riverX = riverCenterX(bridgeZ)
    const bridgeEndX = riverX + RIVER_HALF_WIDTH + 6
    const roadX = farBankRoadCenterX(bridgeZ)
    const length = roadX - bridgeEndX + 1.4
    const centerX = bridgeEndX + length / 2
    const geometry = new THREE.PlaneGeometry(length, 3.8, 6, 1)
    geometry.rotateX(-Math.PI / 2)
    const positions = geometry.attributes.position.array as Float32Array
    for (let i = 0; i < positions.length; i += 3) {
      const x = centerX + positions[i]
      const z = bridgeZ + positions[i + 2]
      positions[i] = x
      positions[i + 1] = sampleHeight(x, z) + 0.08
      positions[i + 2] = z
    }
    geometry.computeVertexNormals()
    const spur = new THREE.Mesh(geometry, roadMat)
    spur.receiveShadow = true
    village.add(spur)
  }

  addLongitudinalRoad()
  addBridgeSpur()

  // Four houses are enough to read as a lived-in hamlet instead of a town.
  const homes = [
    { z: villageZ - 62, side: 1, offset: 6.4 },
    { z: villageZ - 18, side: -1, offset: 5.8 },
    { z: villageZ + 31, side: 1, offset: 7.2 },
    { z: villageZ + 76, side: 1, offset: 5.9 },
  ]
  for (const home of homes) {
    const roadX = farBankRoadCenterX(home.z)
    const x = roadX + home.side * home.offset
    const house = createHouse(random)
    house.position.set(x, sampleHeight(x, home.z) - 0.14, home.z)
    house.rotation.y = home.side > 0 ? -Math.PI / 2 : Math.PI / 2
    village.add(house)

    // A short gravel driveway makes the house-road relationship visible.
    const driveLength = Math.max(2, home.offset - 1.8)
    const driveGeometry = new THREE.PlaneGeometry(driveLength, 1.25, 3, 1)
    driveGeometry.rotateX(-Math.PI / 2)
    const drive = new THREE.Mesh(driveGeometry, gravelMat)
    const drivePositions = driveGeometry.attributes.position.array as Float32Array
    const driveCenterX = roadX + home.side * (1.8 + driveLength / 2)
    for (let i = 0; i < drivePositions.length; i += 3) {
      const wx = driveCenterX + drivePositions[i]
      const wz = home.z + drivePositions[i + 2]
      drivePositions[i] = wx
      drivePositions[i + 1] = sampleHeight(wx, wz) + 0.09
      drivePositions[i + 2] = wz
    }
    driveGeometry.computeVertexNormals()
    drive.receiveShadow = true
    village.add(drive)
  }

  // Small timber jetty: tied to the same river centerline, not the road mesh.
  const dockZ = villageZ - 8
  const riverX = riverCenterX(dockZ)
  const waterY = riverWaterElevationAt(dockZ)
  const dock = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.16, 3.1), timberMat)
  dock.position.set(riverX + RIVER_HALF_WIDTH - 3.4, waterY + 0.16, dockZ)
  dock.castShadow = true
  dock.receiveShadow = true
  village.add(dock)
  for (const x of [riverX + RIVER_HALF_WIDTH - 6.8, riverX + RIVER_HALF_WIDTH - 0.6]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 1.05, 6), timberMat)
    post.position.set(x, waterY + 0.46, dockZ + 1.15)
    post.castShadow = true
    village.add(post)
  }
  const boat = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.28, 0.85), boatMat)
  boat.position.set(riverX + 1.5, waterY + 0.28, dockZ - 2.2)
  boat.rotation.y = -0.1
  boat.castShadow = true
  village.add(boat)

  return village
}
