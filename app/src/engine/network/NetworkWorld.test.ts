import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { NetworkWorld, type NetworkProfile } from './NetworkWorld'
import { NetworkRoute, type NetworkPose } from './NetworkRoute'

// Geometry-only checks: no constructor, DOM, renderer, GPU or audio is created.
interface GeometryWorld {
  route: NetworkRoute
  profile: NetworkProfile
  terrain(s: number, side: number): number
  surface(start: number, end: number, minSide: number, maxSide: number, origin: NetworkPose,
    height: (s: number, side: number) => number, colorize: boolean, sideCells: number): THREE.BufferGeometry
}
function geometryWorld(profile: NetworkProfile) {
  const world = Object.create(NetworkWorld.prototype) as GeometryWorld
  world.route = new NetworkRoute([[-74, 41], [-74.001, 41.004], [-74.003, 41.008]])
  world.profile = profile
  return world
}

describe('NetworkWorld CPU geometry', () => {
  it.each<NetworkProfile>(['woodland', 'desert', 'coast', 'alpine'])('has finite geometry and shared tile edges for %s', profile => {
    const world = geometryWorld(profile), route = world.route
    const leftOrigin = route.pose(128), rightOrigin = route.pose(384), viewOrigin = route.pose(256)
    const make = (start: number, end: number, origin: NetworkPose) => world.surface(start, end, -1400, 1400, origin,
      (s, side) => world.terrain(s, side), true, 16)
    const left = make(0, 256, leftOrigin), right = make(256, 512, rightOrigin)
    const toView = (geometry: THREE.BufferGeometry, origin: NetworkPose, index: number) => {
      const p = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position'), index)
      const offset = route.project(origin, viewOrigin), scale = Math.cos(viewOrigin.latitude * Math.PI / 180) / Math.cos(origin.latitude * Math.PI / 180)
      return new THREE.Vector3(p.x * scale + offset.x, p.y, p.z * scale + offset.z)
    }
    for (const geometry of [left, right]) for (const name of ['position', 'normal', 'color']) {
      expect(Array.from(geometry.getAttribute(name).array).every(Number.isFinite)).toBe(true)
    }
    for (let col = 0; col <= 16; col++) {
      const a = toView(left, leftOrigin, left.getAttribute('position').count - 17 + col)
      const b = toView(right, rightOrigin, col)
      expect(a.distanceTo(b)).toBeLessThan(.001)
      expect(left.getAttribute('normal').getY(left.getAttribute('position').count - 17 + col)).toBeGreaterThan(0)
    }
    left.dispose(); right.dispose()
  })
})
