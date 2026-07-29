import * as THREE from 'three'
import { roadCenterX } from '../terrain/TerrainGen'
import { DEFAULT_ROUTE_PLAN, RURAL_LEVEL_CROSSING_OFFSET, ROUTE_SEGMENT_LENGTH, routeBeatForSegment, type RoutePlan } from '../terrain/RouteFeatures'
import { trackElevationAt } from '../terrain/RouteProfile'

const BUILD_AHEAD = 900
const DISPOSE_BEHIND = 620

/** A streamed, signed rural crossing; city beats use their grade separation. */
class RuralLevelCrossing {
  readonly group = new THREE.Group()
  private resources: (THREE.BufferGeometry | THREE.Material)[] = []

  constructor(z: number) {
    const y = trackElevationAt(z)
    const asphalt = this.mat(0x4a4843, 0.9)
    const panel = this.mat(0x716d64, 0.95)
    const steel = this.mat(0x343b3c, 0.38, 0.7)
    const red = this.basic(0xc8362c)
    const white = this.basic(0xf0eee4)
    const startX = -10
    const endX = roadCenterX(z) + 1.4
    this.add(this.box(endX - startX, 0.1, 5.5), asphalt, (startX + endX) / 2, y + 0.02, z)
    for (const x of [-2.9, -0.95, 0.95, 2.9]) this.add(this.box(1.55, 0.12, 5.7), panel, x, y + 0.11, z)

    for (const side of [-1, 1]) {
      const mastX = 7.8
      const mastZ = z + side * 4.25
      this.add(this.cylinder(0.11, 0.16, 3.05), steel, mastX, y + 1.525, mastZ)
      this.add(this.cylinder(0.07, 0.09, 2.15), steel, mastX + 0.72, y + 1.075, mastZ)
      for (const angle of [Math.PI / 4, -Math.PI / 4]) {
        const cross = new THREE.Mesh(this.box(0.12, 0.72, 0.12), white)
        cross.position.set(mastX + 0.72, y + 2.15, mastZ)
        cross.rotation.z = angle
        this.group.add(cross)
      }
      this.add(this.sphere(0.16), red, mastX - 0.08, y + 2.32, mastZ)
      this.add(this.box(0.12, 0.1, 4.35), white, mastX - 0.18, y + 1.42, mastZ - side * 2.1)
    }
  }

  private add(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.group.add(mesh)
  }
  private box(x: number, y: number, z: number) { const g = new THREE.BoxGeometry(x, y, z); this.resources.push(g); return g }
  private cylinder(t: number, b: number, h: number) { const g = new THREE.CylinderGeometry(t, b, h, 7); this.resources.push(g); return g }
  private sphere(r: number) { const g = new THREE.SphereGeometry(r, 8, 6); this.resources.push(g); return g }
  private mat(color: number, roughness: number, metalness = 0) { const m = new THREE.MeshStandardMaterial({ color, roughness, metalness }); this.resources.push(m); return m }
  private basic(color: number) { const m = new THREE.MeshBasicMaterial({ color }); this.resources.push(m); return m }
  dispose() { for (const resource of this.resources) resource.dispose(); this.resources = [] }
}

export class LevelCrossingManager {
  readonly group = new THREE.Group()
  private crossing: RuralLevelCrossing | null = null
  private crossingZ = 0
  private routePlan: RoutePlan

  constructor(routePlan: RoutePlan = DEFAULT_ROUTE_PLAN) {
    this.routePlan = routePlan
  }

  update(camZ: number) {
    if (!this.crossing) {
      const z = this.nextCrossingZ(camZ)
      if (z < camZ + BUILD_AHEAD) {
        this.crossing = new RuralLevelCrossing(z)
        this.crossingZ = z
        this.group.add(this.crossing.group)
      }
    } else if (camZ > this.crossingZ + DISPOSE_BEHIND) {
      this.group.remove(this.crossing.group)
      this.crossing.dispose()
      this.crossing = null
    }
  }

  private nextCrossingZ(camZ: number) {
    const first = Math.floor((camZ - RURAL_LEVEL_CROSSING_OFFSET) / ROUTE_SEGMENT_LENGTH)
    for (let segment = first; segment < first + 12; segment++) {
      if (routeBeatForSegment(segment, this.routePlan).station !== 'rural-halt') continue
      const z = segment * ROUTE_SEGMENT_LENGTH + RURAL_LEVEL_CROSSING_OFFSET
      if (z > camZ - 45) return z
    }
    return Number.POSITIVE_INFINITY
  }

  dispose() {
    if (!this.crossing) return
    this.group.remove(this.crossing.group)
    this.crossing.dispose()
    this.crossing = null
  }
}
