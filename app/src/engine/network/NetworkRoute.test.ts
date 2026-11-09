import { describe, expect, it } from 'vitest'
import { NetworkRoute } from './NetworkRoute'

describe('NetworkRoute geographic component', () => {
  it('uses metre distances and retains geographic endpoints', () => {
    const route = new NetworkRoute([[-74, 41], [-74, 41.01], [-73.99, 41.01]])
    expect(route.length).toBeGreaterThan(1900)
    expect(route.length).toBeLessThan(2000)
    expect(route.pose(0).longitude).toBe(-74)
    expect(route.pose(route.length).longitude).toBe(-73.99)
    expect(route.pose(route.length).latitude).toBe(41.01)
    const mid = route.pose(route.distances[1] / 2)
    expect(mid.latitude).toBeCloseTo(41.005, 6)
    expect(Math.hypot(mid.east, mid.north)).toBeCloseTo(1)
  })
  it('drops consecutive repeated vertices and rejects invalid components', () => {
    expect(new NetworkRoute([[0, 0], [0, 0], [0, .01]]).points).toHaveLength(2)
    expect(() => new NetworkRoute([[0, 0], [0, 0]])).toThrow()
    expect(() => new NetworkRoute([[NaN, 0], [0, 1]])).toThrow()
    expect(() => new NetworkRoute([[0, 91], [0, 1]])).toThrow()
    expect(() => new NetworkRoute([[0, 0], [0, 1]]).pose(NaN)).toThrow()
  })
  it('takes the short crossing at the antimeridian and clamps finite seeks', () => {
    const route = new NetworkRoute([[179.99, 40], [-179.99, 40]])
    expect(route.length).toBeLessThan(2000)
    expect(Math.abs(route.pose(route.length / 2).longitude)).toBeCloseTo(180)
    const a = route.pose(0), b = route.pose(route.length)
    expect(route.project(b, a).x).toBeGreaterThan(1000)
    expect(route.project(b, a).x).toBeLessThan(2000)
    expect(route.pose(-5).distance).toBe(0)
    expect(() => route.pose(Infinity)).toThrow()
    expect(route.pose(route.length + 20).distance).toBe(route.length)
  })
  it('keeps source corners in the rendered sampling and composes local frames', () => {
    const route = new NetworkRoute([[-74, 41], [-74, 41.001], [-73.998, 41.001]])
    expect(route.samples(0, route.length, 16)).toContain(route.distances[1])
    const a = route.pose(0), b = route.pose(100), c = route.pose(180)
    const ab = route.project(b, a), bc = route.project(c, b), ac = route.project(c, a)
    const scale = Math.cos(a.latitude * Math.PI / 180) / Math.cos(b.latitude * Math.PI / 180)
    expect(ab.x + bc.x * scale).toBeCloseTo(ac.x, 5)
    expect(ab.z + bc.z * scale).toBeCloseTo(ac.z, 5)
  })
})
