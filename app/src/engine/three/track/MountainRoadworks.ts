import * as THREE from 'three'
import { ROAD_HALF_WIDTH, roadCenterX } from '../terrain/TerrainGen'
import {
  MOUNTAIN_TUNNEL_LENGTH,
  MOUNTAIN_TUNNEL_OFFSET,
  ROUTE_SEGMENT_LENGTH,
  routeFeatureForSegment,
} from '../terrain/RouteFeatures'

const BUILD_AHEAD = 900
const DISPOSE_BEHIND = 650
const APPROACH_LENGTH = 250
const WALL_SEGMENT_LENGTH = 18
const WALL_HEIGHT = 0.92

type HeightSampler = (x: number, z: number) => number

/**
 * A short retaining-wall run makes the parallel mountain road read as an
 * engineered approach to the rail tunnel, rather than a terrain colour band.
 * Every section samples the same triangulated terrain surface used for props.
 */
class MountainRoadwork {
  readonly group = new THREE.Group()
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = []

  constructor(zCenter: number, sampleHeight: HeightSampler) {
    const wallStart = zCenter - MOUNTAIN_TUNNEL_LENGTH / 2 - APPROACH_LENGTH
    const wallEnd = zCenter - MOUNTAIN_TUNNEL_LENGTH / 2 - 12
    const wallMat = this.track(new THREE.MeshStandardMaterial({
      color: 0x6f7067, roughness: 0.94, metalness: 0.02,
    }))
    const postMat = this.track(new THREE.MeshStandardMaterial({
      color: 0x303633, roughness: 0.72, metalness: 0.18,
    }))
    const reflectorMat = this.track(new THREE.MeshBasicMaterial({ color: 0xe5d7a4 }))

    for (let z = wallStart; z < wallEnd; z += WALL_SEGMENT_LENGTH) {
      const segmentEnd = Math.min(z + WALL_SEGMENT_LENGTH, wallEnd)
      const zMid = (z + segmentEnd) / 2
      const x = roadCenterX(zMid) + ROAD_HALF_WIDTH + 0.36
      const h0 = sampleHeight(x, z)
      const h1 = sampleHeight(x, segmentEnd)
      const length = segmentEnd - z
      const wall = new THREE.Mesh(this.box(0.42, WALL_HEIGHT, length + 0.2), wallMat)
      wall.position.set(x, (h0 + h1) / 2 + WALL_HEIGHT / 2, zMid)
      wall.rotation.x = -Math.atan2(h1 - h0, length)
      wall.castShadow = true
      wall.receiveShadow = true
      this.group.add(wall)
    }

    // Reflectors sit on the track-side edge of the road, so they stay legible
    // from the cabin while the wall follows the outer uphill edge.
    for (let z = wallStart + 18; z < wallEnd - 8; z += 36) {
      const x = roadCenterX(z) - ROAD_HALF_WIDTH - 0.22
      const ground = sampleHeight(x, z)
      const post = new THREE.Mesh(this.box(0.13, 0.72, 0.13), postMat)
      post.position.set(x, ground + 0.36, z)
      post.castShadow = true
      this.group.add(post)

      const reflector = new THREE.Mesh(this.box(0.16, 0.2, 0.03), reflectorMat)
      reflector.position.set(x - 0.08, ground + 0.52, z)
      this.group.add(reflector)
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

/** Streams one upcoming mountain-road approach alongside the matching tunnel. */
export class MountainRoadworkManager {
  readonly group = new THREE.Group()
  private roadwork: MountainRoadwork | null = null
  private roadworkCenter = 0
  private sampleHeight: HeightSampler

  constructor(sampleHeight: HeightSampler) {
    this.sampleHeight = sampleHeight
  }

  private nextRoadworkCenter(camZ: number): number {
    const firstSegment = Math.floor((camZ - MOUNTAIN_TUNNEL_OFFSET) / ROUTE_SEGMENT_LENGTH)
    for (let segment = firstSegment; segment < firstSegment + 12; segment++) {
      if (!routeFeatureForSegment(segment).tunnel) continue
      const center = segment * ROUTE_SEGMENT_LENGTH + MOUNTAIN_TUNNEL_OFFSET
      if (center + MOUNTAIN_TUNNEL_LENGTH / 2 > camZ - 50) return center
    }
    return Number.POSITIVE_INFINITY
  }

  update(camZ: number) {
    if (!this.roadwork) {
      const center = this.nextRoadworkCenter(camZ)
      if (center - MOUNTAIN_TUNNEL_LENGTH / 2 - APPROACH_LENGTH < camZ + BUILD_AHEAD) {
        this.roadwork = new MountainRoadwork(center, this.sampleHeight)
        this.roadworkCenter = center
        this.group.add(this.roadwork.group)
      }
    } else if (camZ > this.roadworkCenter + MOUNTAIN_TUNNEL_LENGTH / 2 + DISPOSE_BEHIND) {
      this.group.remove(this.roadwork.group)
      this.roadwork.dispose()
      this.roadwork = null
    }
  }

  dispose() {
    if (this.roadwork) {
      this.group.remove(this.roadwork.group)
      this.roadwork.dispose()
      this.roadwork = null
    }
  }
}
