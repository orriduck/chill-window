import * as THREE from 'three'
import { trackElevationAt } from './RouteProfile'

type HeightSampler = (x: number, z: number) => number

export const TOWN_ROAD_BRIDGE_CLEARANCE = 5.2
export const TOWN_ROAD_BRIDGE_RAMP_LENGTH = 86
export const TOWN_ROAD_BRIDGE_TARGET_GRADE = TOWN_ROAD_BRIDGE_CLEARANCE / TOWN_ROAD_BRIDGE_RAMP_LENGTH
export const TOWN_ROAD_BRIDGE_DECK_THICKNESS = 0.3
export const TOWN_ROAD_BRIDGE_PIER_XS = [-7, 7] as const

const BRIDGE_Z_OFFSET = -100
const RURAL_RAMP_X = -22
const ROAD_WIDTH = 4
const ROAD_HALF_WIDTH = ROAD_WIDTH / 2
const DECK_HALF_DEPTH = 2.6

export interface TownRoadBridgeLayout {
  bridgeZ: number
  deckStartX: number
  deckEndX: number
  townRampX: number
  townRampEndZ: number
  ruralRampX: number
  ruralRampEndZ: number
  ruralRoadEndZ: number
}

/**
 * A grade-separated road link at the edge of every planned town. The town
 * ramp meets the existing parallel street; the rural ramp continues as a
 * service road on the other side of the railway.
 */
export function townRoadBridgeLayout(townX: number, townZ: number): TownRoadBridgeLayout {
  const bridgeZ = townZ + BRIDGE_Z_OFFSET
  return {
    bridgeZ,
    deckStartX: RURAL_RAMP_X,
    deckEndX: townX,
    townRampX: townX,
    townRampEndZ: bridgeZ + TOWN_ROAD_BRIDGE_RAMP_LENGTH,
    ruralRampX: RURAL_RAMP_X,
    ruralRampEndZ: bridgeZ - TOWN_ROAD_BRIDGE_RAMP_LENGTH,
    ruralRoadEndZ: bridgeZ - TOWN_ROAD_BRIDGE_RAMP_LENGTH - 64,
  }
}

/** Shared clearing footprint for the deck, ramp slopes, and rural continuation. */
export function isTownRoadBridgeFootprint(x: number, z: number, townX: number, townZ: number): boolean {
  const layout = townRoadBridgeLayout(townX, townZ)
  const withinDeck =
    Math.abs(z - layout.bridgeZ) <= DECK_HALF_DEPTH + 1.2 &&
    x >= layout.deckStartX - 1.5 &&
    x <= layout.deckEndX + 1.5
  const withinTownRamp =
    Math.abs(x - layout.townRampX) <= ROAD_HALF_WIDTH + 1.2 &&
    z >= layout.bridgeZ - 1.2 &&
    z <= layout.townRampEndZ + 1.2
  const withinRuralApproach =
    Math.abs(x - layout.ruralRampX) <= ROAD_HALF_WIDTH + 1.2 &&
    z >= layout.ruralRoadEndZ - 1.2 &&
    z <= layout.bridgeZ + 1.2

  return withinDeck || withinTownRamp || withinRuralApproach
}

function createRampSurface(
  x: number,
  startZ: number,
  endZ: number,
  heightAt: (t: number, z: number) => number,
  material: THREE.Material,
): THREE.Mesh {
  const segments = 12
  const positions = new Float32Array((segments + 1) * 2 * 3)
  const indices: number[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const z = THREE.MathUtils.lerp(startZ, endZ, t)
    const y = heightAt(t, z)
    const offset = i * 6
    positions.set([x - ROAD_HALF_WIDTH, y, z, x + ROAD_HALF_WIDTH, y, z], offset)
    if (i < segments) {
      const a = i * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const surface = new THREE.Mesh(geometry, material)
  surface.receiveShadow = true
  return surface
}

function addRampGuardrails(
  group: THREE.Group,
  x: number,
  startZ: number,
  endZ: number,
  heightAt: (t: number, z: number) => number,
  material: THREE.Material,
) {
  const postGeometry = new THREE.BoxGeometry(0.12, 0.8, 0.12)
  const segments = 6

  for (const side of [-1, 1]) {
    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      const z = THREE.MathUtils.lerp(startZ, endZ, t)
      const post = new THREE.Mesh(postGeometry, material)
      post.position.set(
        x + side * (ROAD_HALF_WIDTH - 0.06),
        heightAt(t, z) + 0.4,
        z,
      )
      post.castShadow = true
      group.add(post)
    }

    for (let i = 0; i < segments; i++) {
      const startT = i / segments
      const endT = (i + 1) / segments
      const startZPoint = THREE.MathUtils.lerp(startZ, endZ, startT)
      const endZPoint = THREE.MathUtils.lerp(startZ, endZ, endT)
      const startY = heightAt(startT, startZPoint)
      const endY = heightAt(endT, endZPoint)
      const dz = endZPoint - startZPoint
      const dy = endY - startY
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, Math.hypot(dz, dy)), material)
      rail.position.set(
        x + side * (ROAD_HALF_WIDTH - 0.06),
        (startY + endY) / 2 + 0.76,
        (startZPoint + endZPoint) / 2,
      )
      rail.rotation.x = -Math.atan2(dy, dz)
      rail.castShadow = true
      group.add(rail)
    }
  }
}

/** Build the bridge, supported ramps, and a short rural road continuation. */
export function createTownRoadBridge(
  townX: number,
  townZ: number,
  sampleHeight: HeightSampler,
): THREE.Group {
  const group = new THREE.Group()
  const layout = townRoadBridgeLayout(townX, townZ)
  const deckY = trackElevationAt(layout.bridgeZ) + TOWN_ROAD_BRIDGE_CLEARANCE
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x4d4b48, roughness: 0.94 })
  const concreteMat = new THREE.MeshStandardMaterial({ color: 0x8a8c86, roughness: 0.9 })
  const railMat = new THREE.MeshStandardMaterial({ color: 0x45494a, roughness: 0.48, metalness: 0.46 })

  const deckLength = layout.deckEndX - layout.deckStartX
  const deck = new THREE.Mesh(new THREE.BoxGeometry(deckLength, TOWN_ROAD_BRIDGE_DECK_THICKNESS, ROAD_WIDTH), roadMat)
  deck.position.set((layout.deckStartX + layout.deckEndX) / 2, deckY - TOWN_ROAD_BRIDGE_DECK_THICKNESS / 2, layout.bridgeZ)
  deck.castShadow = true
  deck.receiveShadow = true
  group.add(deck)

  // The piers stand clear of the rails on either side of the permanent way.
  for (const x of TOWN_ROAD_BRIDGE_PIER_XS) {
    const ground = sampleHeight(x, layout.bridgeZ)
    const height = Math.max(0.5, deckY - TOWN_ROAD_BRIDGE_DECK_THICKNESS + 0.05 - ground)
    const pier = new THREE.Mesh(new THREE.BoxGeometry(1.05, height, 1.7), concreteMat)
    pier.position.set(x, ground + height / 2, layout.bridgeZ)
    pier.castShadow = true
    pier.receiveShadow = true
    group.add(pier)
  }

  const deckGuardGeometry = new THREE.BoxGeometry(deckLength + 0.2, 0.12, 0.12)
  for (const side of [-1, 1]) {
    const guard = new THREE.Mesh(deckGuardGeometry, railMat)
    guard.position.set((layout.deckStartX + layout.deckEndX) / 2, deckY + 0.72, layout.bridgeZ + side * (ROAD_HALF_WIDTH - 0.08))
    guard.castShadow = true
    group.add(guard)
  }
  for (let x = layout.deckStartX + 2; x < layout.deckEndX; x += 5) {
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.8, 0.12), railMat)
      post.position.set(x, deckY + 0.4, layout.bridgeZ + side * (ROAD_HALF_WIDTH - 0.08))
      post.castShadow = true
      group.add(post)
    }
  }

  const townRampEndY = sampleHeight(layout.townRampX, layout.townRampEndZ) + 0.09
  const townRampHeightAt = (t: number, z: number) => Math.max(
    THREE.MathUtils.lerp(deckY, townRampEndY, t),
    sampleHeight(layout.townRampX, z) + 0.09,
  )
  const townRamp = createRampSurface(
    layout.townRampX,
    layout.bridgeZ,
    layout.townRampEndZ,
    townRampHeightAt,
    roadMat,
  )
  group.add(townRamp)
  addRampGuardrails(group, layout.townRampX, layout.bridgeZ, layout.townRampEndZ, townRampHeightAt, railMat)

  const ruralRampEndY = sampleHeight(layout.ruralRampX, layout.ruralRampEndZ) + 0.09
  const ruralRampHeightAt = (t: number, z: number) => Math.max(
    THREE.MathUtils.lerp(deckY, ruralRampEndY, t),
    sampleHeight(layout.ruralRampX, z) + 0.09,
  )
  const ruralRamp = createRampSurface(
    layout.ruralRampX,
    layout.bridgeZ,
    layout.ruralRampEndZ,
    ruralRampHeightAt,
    roadMat,
  )
  group.add(ruralRamp)
  addRampGuardrails(group, layout.ruralRampX, layout.bridgeZ, layout.ruralRampEndZ, ruralRampHeightAt, railMat)

  for (const ramp of [
    { x: layout.townRampX, startZ: layout.bridgeZ, endZ: layout.townRampEndZ, heightAt: townRampHeightAt },
    { x: layout.ruralRampX, startZ: layout.bridgeZ, endZ: layout.ruralRampEndZ, heightAt: ruralRampHeightAt },
  ]) {
    for (let i = 1; i < 4; i++) {
      const t = i / 4
      const z = THREE.MathUtils.lerp(ramp.startZ, ramp.endZ, t)
      const roadY = ramp.heightAt(t, z)
      const ground = sampleHeight(ramp.x, z)
      const height = roadY - ground
      if (height < 0.65) continue
      const support = new THREE.Mesh(new THREE.BoxGeometry(0.7, height, 0.9), concreteMat)
      support.position.set(ramp.x, ground + height / 2, z)
      support.castShadow = true
      support.receiveShadow = true
      group.add(support)
    }
  }

  group.add(createRampSurface(
    layout.ruralRampX,
    layout.ruralRampEndZ,
    layout.ruralRoadEndZ,
    (_t, z) => sampleHeight(layout.ruralRampX, z) + 0.09,
    roadMat,
  ))

  return group
}
