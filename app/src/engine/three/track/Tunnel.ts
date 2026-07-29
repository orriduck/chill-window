import * as THREE from 'three'
import { createSeededRandom, seedFromGrid } from '../core/procedural'
import { trackElevationAt, trackGradeAt } from '../terrain/RouteProfile'
import { ROUTE_SEGMENT_LENGTH, routeFeatureForSegment } from '../terrain/RouteFeatures'

// Tunnel geometry
const TUNNEL_LENGTH = 280
const TUNNEL_RADIUS = 5.2
const MOUND_RADIUS = 11
const PORTAL_W = 14
const PORTAL_H = 9.5
const PORTAL_DEPTH = 1.4
const ARCH_R = 4.3
const ARCH_SPRING = 2.6 // height where the arch curve starts

const TUNNEL_OFFSET = ROUTE_SEGMENT_LENGTH * 0.72 // centre of a mountain segment
const BUILD_AHEAD = 900 // build when the camera gets this close
const DISPOSE_BEHIND = 600 // dispose once this far past the exit

function smoothstep(t: number): number {
  t = Math.max(0, Math.min(1, t))
  return t * t * (3 - 2 * t)
}

/** A single tunnel: an earthen mound over a concrete arch tube, stone
 *  portals at both ends, and a strip of interior ceiling lights. */
class Tunnel {
  readonly group = new THREE.Group()
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = []

  constructor(zCenter: number) {
    const random = createSeededRandom(seedFromGrid(0, Math.floor(zCenter), 51))
    this.group.position.set(0, trackElevationAt(zCenter), zCenter)
    this.group.rotation.x = -Math.atan(trackGradeAt(zCenter))

    // ---- Earthen mound: half-cylinder shell covering the tube ----
    const moundGeom = this.track(
      new THREE.CylinderGeometry(MOUND_RADIUS, MOUND_RADIUS, TUNNEL_LENGTH, 28, 1, true, Math.PI / 2, Math.PI)
    )
    moundGeom.rotateX(Math.PI / 2) // axis along Z, arch covering y>0
    const moundMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x49673c, roughness: 1.0, metalness: 0 })
    )
    const mound = new THREE.Mesh(moundGeom, moundMat)
    mound.castShadow = true
    mound.receiveShadow = true
    this.group.add(mound)

    // Rocky cap near the crest so the mound isn't pure lawn
    const capMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x77705f, roughness: 0.95, flatShading: true })
    )
    for (let i = 0; i < 5; i++) {
      const rock = new THREE.Mesh(this.track(new THREE.DodecahedronGeometry(0.8 + random() * 0.9, 0)), capMat)
      const a = Math.PI / 2 + (random() - 0.5) * 0.9 // near the crest
      const r = MOUND_RADIUS - 0.3
      // Place on the mound surface: cross-section is in XY
      rock.position.set(
        Math.cos(a) * r,
        Math.sin(a) * r,
        (random() - 0.5) * (TUNNEL_LENGTH - 40)
      )
      rock.rotation.set(random(), random() * Math.PI, random())
      this.group.add(rock)
    }

    // ---- Concrete tube interior (we see its inside) ----
    const tubeGeom = this.track(
      new THREE.CylinderGeometry(TUNNEL_RADIUS, TUNNEL_RADIUS, TUNNEL_LENGTH, 24, 1, true, Math.PI / 2, Math.PI)
    )
    tubeGeom.rotateX(Math.PI / 2)
    const tubeMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0x26262b, roughness: 0.9, metalness: 0.05, side: THREE.BackSide,
      })
    )
    const tube = new THREE.Mesh(tubeGeom, tubeMat)
    this.group.add(tube)

    // ---- Interior ceiling light strip ----
    const lampGeom = this.track(new THREE.BoxGeometry(0.5, 0.08, 1.4))
    const lampMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xffeecc, emissive: 0xffdd99, emissiveIntensity: 1.4, roughness: 0.4,
      })
    )
    for (let z = -TUNNEL_LENGTH / 2 + 12; z < TUNNEL_LENGTH / 2 - 6; z += 16) {
      const lamp = new THREE.Mesh(lampGeom, lampMat)
      lamp.position.set(0, TUNNEL_RADIUS - 0.25, z)
      this.group.add(lamp)
    }
    // Wall cable trays (dark ledges at both sides) for interior detail
    const trayMat = this.track(new THREE.MeshStandardMaterial({ color: 0x17171a, roughness: 0.9 }))
    for (const side of [-1, 1]) {
      const tray = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.25, 0.35, TUNNEL_LENGTH)), trayMat)
      tray.position.set(side * (TUNNEL_RADIUS - 0.3), 1.6, 0)
      tray.rotation.z = -side * 0.35
      this.group.add(tray)
    }

    // ---- Stone portals at both ends ----
    for (const side of [-1, 1]) {
      const portal = this.buildPortal()
      portal.position.z = side * (TUNNEL_LENGTH / 2)
      this.group.add(portal)
    }
  }

  /** Portal wall: rectangular stone face with an arched opening,
   *  plus angled wing walls holding back the mound. */
  private buildPortal(): THREE.Group {
    const portal = new THREE.Group()
    const stoneMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 0.9, metalness: 0.02 })
    )
    const trimMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x6e6a5e, roughness: 0.9 })
    )

    // Wall with arch hole, extruded
    const shape = new THREE.Shape()
    shape.moveTo(-PORTAL_W / 2, 0)
    shape.lineTo(PORTAL_W / 2, 0)
    shape.lineTo(PORTAL_W / 2, PORTAL_H)
    shape.lineTo(-PORTAL_W / 2, PORTAL_H)
    shape.closePath()
    const hole = new THREE.Path()
    hole.moveTo(-ARCH_R, 0)
    hole.lineTo(-ARCH_R, ARCH_SPRING)
    hole.absarc(0, ARCH_SPRING, ARCH_R, Math.PI, 0, true)
    hole.lineTo(ARCH_R, 0)
    hole.closePath()
    shape.holes.push(hole)
    const geom = this.track(new THREE.ExtrudeGeometry(shape, { depth: PORTAL_DEPTH, bevelEnabled: false }))
    geom.translate(0, 0, -PORTAL_DEPTH / 2)
    const wall = new THREE.Mesh(geom, stoneMat)
    wall.castShadow = true
    portal.add(wall)

    // Parapet trim across the top
    const trim = new THREE.Mesh(this.track(new THREE.BoxGeometry(PORTAL_W + 0.6, 0.5, PORTAL_DEPTH + 0.4)), trimMat)
    trim.position.y = PORTAL_H + 0.2
    portal.add(trim)

    // Wing walls angled out to the sides
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.9, PORTAL_H * 0.7, 7)), stoneMat)
      wing.position.set(side * (PORTAL_W / 2 + 2.2), PORTAL_H * 0.35, 0)
      wing.rotation.y = side * 0.5
      portal.add(wing)
    }

    return portal
  }

  private track<T extends THREE.BufferGeometry | THREE.Material>(resource: T): T {
    this.disposables.push(resource)
    return resource
  }

  dispose() {
    for (const r of this.disposables) r.dispose()
    this.disposables = []
  }
}

/** Schedules tunnels inside mountain-biome segments and reports how dark
 *  the world should be (0 = open air, 1 = deep inside the bore). */
export class TunnelManager {
  readonly group = new THREE.Group()
  private tunnel: Tunnel | null = null
  private zStart = 0
  private zEnd = 0
  /** 0..1 — how enclosed the camera currently is. */
  darkness = 0

  /** Centre Z of the next scheduled tunnel at or after the camera. */
  private nextTunnelCenter(camZ: number): number {
    const n0 = Math.floor((camZ - TUNNEL_OFFSET) / ROUTE_SEGMENT_LENGTH)
    for (let n = n0; n < n0 + 12; n++) {
      if (routeFeatureForSegment(n).tunnel) {
        const center = n * ROUTE_SEGMENT_LENGTH + TUNNEL_OFFSET
        if (center + TUNNEL_LENGTH / 2 > camZ - 50) return center
      }
    }
    return Number.POSITIVE_INFINITY
  }

  update(camZ: number): number {
    // Build the upcoming tunnel when it enters the draw distance
    if (!this.tunnel) {
      const center = this.nextTunnelCenter(camZ)
      if (center - TUNNEL_LENGTH / 2 < camZ + BUILD_AHEAD) {
        this.tunnel = new Tunnel(center)
        this.zStart = center - TUNNEL_LENGTH / 2
        this.zEnd = center + TUNNEL_LENGTH / 2
        this.group.add(this.tunnel.group)
      }
    } else if (camZ > this.zEnd + DISPOSE_BEHIND) {
      this.group.remove(this.tunnel.group)
      this.tunnel.dispose()
      this.tunnel = null
    }

    // Enclosure ramps up through the entrance portal and down at the exit
    if (this.tunnel) {
      const rampIn = smoothstep((camZ - (this.zStart - 8)) / 30)
      const rampOut = 1 - smoothstep((camZ - (this.zEnd - 25)) / 30)
      this.darkness = Math.min(rampIn, rampOut)
    } else {
      this.darkness = 0
    }
    return this.darkness
  }

  dispose() {
    if (this.tunnel) {
      this.group.remove(this.tunnel.group)
      this.tunnel.dispose()
      this.tunnel = null
    }
  }
}
