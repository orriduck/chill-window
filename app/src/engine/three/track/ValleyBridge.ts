import * as THREE from 'three'
import {
  RIVER_HALF_WIDTH,
  riverCenterX,
  riverWaterElevationAt,
  roadCenterX,
} from '../terrain/TerrainGen'
import { ROUTE_SEGMENT_LENGTH, routeFeatureForSegment } from '../terrain/RouteFeatures'
import { trackElevationAt } from '../terrain/RouteProfile'

const BRIDGE_OFFSET = 420
const BUILD_AHEAD = 900
const DISPOSE_BEHIND = 650

/**
 * A small road bridge explains how the existing parallel valley road reaches
 * the far bank. It is a route feature rather than a terrain decoration: one
 * stable crossing per river segment, built ahead of the side-window view and
 * released only after the train has passed it.
 */
class ValleyRoadBridge {
  readonly group = new THREE.Group()
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = []

  constructor(zCenter: number) {
    const roadX = roadCenterX(zCenter)
    const riverX = riverCenterX(zCenter)
    const deckStart = roadX - 1.5
    const deckEnd = riverX + RIVER_HALF_WIDTH + 6
    const deckLength = deckEnd - deckStart
    const deckCenterX = (deckStart + deckEnd) / 2
    const waterY = riverWaterElevationAt(zCenter)
    const deckY = trackElevationAt(zCenter) + 0.34

    const deckMat = this.track(new THREE.MeshStandardMaterial({
      color: 0x51565b, roughness: 0.82, metalness: 0.16,
    }))
    const railMat = this.track(new THREE.MeshStandardMaterial({
      color: 0x6e7980, roughness: 0.42, metalness: 0.72,
    }))
    const concreteMat = this.track(new THREE.MeshStandardMaterial({
      color: 0x8c8a82, roughness: 0.93, metalness: 0,
    }))
    const reflectorMat = this.track(new THREE.MeshStandardMaterial({
      color: 0xe9d8a3, emissive: 0x7e6b3c, emissiveIntensity: 0.18, roughness: 0.42,
    }))

    const deck = new THREE.Mesh(this.box(deckLength, 0.24, 4.6), deckMat)
    deck.position.set(deckCenterX, deckY, zCenter)
    deck.castShadow = true
    deck.receiveShadow = true
    this.group.add(deck)

    // Parapet rails leave the water readable through the carriage window.
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(this.box(deckLength, 0.08, 0.08), railMat)
      rail.position.set(deckCenterX, deckY + 0.56, zCenter + side * 2.06)
      this.group.add(rail)

      for (let x = deckStart + 1.5; x < deckEnd - 1; x += 3.2) {
        const post = new THREE.Mesh(this.box(0.08, 0.58, 0.08), railMat)
        post.position.set(x, deckY + 0.3, zCenter + side * 2.06)
        this.group.add(post)
      }
    }

    const supportHeight = Math.max(0.75, deckY - waterY)
    const supportY = waterY + supportHeight / 2
    for (const x of [
      deckStart + 1.6,
      riverX - RIVER_HALF_WIDTH * 0.35,
      riverX + RIVER_HALF_WIDTH * 0.35,
      deckEnd - 1.6,
    ]) {
      const support = new THREE.Mesh(this.box(1.05, supportHeight, 5.1), concreteMat)
      support.position.set(x, supportY, zCenter)
      support.castShadow = true
      support.receiveShadow = true
      this.group.add(support)
    }

    // Dusk-visible roadside reflectors without introducing a second light rig.
    for (const side of [-1, 1]) {
      const marker = new THREE.Mesh(this.box(0.16, 0.5, 0.12), reflectorMat)
      marker.position.set(deckEnd - 0.4, deckY + 0.24, zCenter + side * 1.72)
      this.group.add(marker)
    }
  }

  private box(width: number, height: number, depth: number): THREE.BoxGeometry {
    const geometry = new THREE.BoxGeometry(width, height, depth)
    this.disposables.push(geometry)
    return geometry
  }

  private track<T extends THREE.Material>(material: T): T {
    this.disposables.push(material)
    return material
  }

  dispose() {
    for (const resource of this.disposables) resource.dispose()
    this.disposables = []
  }
}

export class ValleyBridgeManager {
  readonly group = new THREE.Group()
  private bridge: ValleyRoadBridge | null = null
  private bridgeZ = 0

  private nextBridgeZ(camZ: number): number {
    const firstSegment = Math.floor((camZ - BRIDGE_OFFSET) / ROUTE_SEGMENT_LENGTH)
    for (let segment = firstSegment; segment < firstSegment + 12; segment++) {
      if (routeFeatureForSegment(segment).biome !== 'river') continue
      const z = segment * ROUTE_SEGMENT_LENGTH + BRIDGE_OFFSET
      if (z > camZ - 50) return z
    }
    return Number.POSITIVE_INFINITY
  }

  update(camZ: number) {
    if (!this.bridge) {
      const z = this.nextBridgeZ(camZ)
      if (z < camZ + BUILD_AHEAD) {
        this.bridge = new ValleyRoadBridge(z)
        this.bridgeZ = z
        this.group.add(this.bridge.group)
      }
    } else if (camZ > this.bridgeZ + DISPOSE_BEHIND) {
      this.group.remove(this.bridge.group)
      this.bridge.dispose()
      this.bridge = null
    }
  }

  dispose() {
    if (this.bridge) {
      this.group.remove(this.bridge.group)
      this.bridge.dispose()
      this.bridge = null
    }
  }
}
