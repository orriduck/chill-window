/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GeoData, contains, type GeoBundle } from './GeoData'
const bundle = JSON.parse(readFileSync(new URL('../../../../public/geodata/hudson/world.json', import.meta.url), 'utf8')) as GeoBundle
const bytes = readFileSync(new URL('../../../../public/geodata/hudson/elevation.f32', import.meta.url))
const data = new GeoData(bundle, new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)))
describe('Hudson source alignment', () => {
  it('uses the source route, pixel-centre bounds and south-to-north rows', () => {
    expect(data.length).toBeCloseTo(22837.381660, 3)
    const d = bundle.dem
    for (const [column, row] of [[0,0], [d.width-1,0], [0,d.height-1], [d.width-1,d.height-1], [143,765]]) {
      const x = d.bounds[0] + column * (d.bounds[2]-d.bounds[0]) / (d.width-1)
      const z = d.bounds[1] + row * (d.bounds[3]-d.bounds[1]) / (d.height-1)
      expect(data.heightAt(x,z)).toBeCloseTo(data.elevations[row*d.width+column], 6)
    }
    expect(data.heightAt(d.bounds[0]-1, d.bounds[1])).toBeNull()
    for (const point of bundle.route.points.filter((_,i)=>i%31===0)) {
      const local = data.project(point), back = data.unproject(local.x,local.z)
      expect(back[0]).toBeCloseTo(point[0], 9); expect(back[1]).toBeCloseTo(point[1], 9)
    }
  })
  it('maps the real centreline and tangent into the train frame throughout the route', () => {
    for (let s=0; s<data.length; s+=173) {
      const p=data.pose(s), transform=new THREE.Matrix4().makeRotationY(-p.heading)
      transform.setPosition(-p.dz*p.x+p.dx*p.z,0,s-p.dx*p.x-p.dz*p.z)
      const position=new THREE.Vector3(p.x,0,p.z).applyMatrix4(transform)
      const direction=new THREE.Vector3(p.dx,0,p.dz).transformDirection(transform)
      expect(position.x).toBeCloseTo(0,8); expect(position.z).toBeCloseTo(s,8)
      expect(direction.x).toBeCloseTo(0,8); expect(direction.z).toBeCloseTo(1,8)
      expect(Math.abs(data.railGrade(s))).toBeLessThanOrEqual(0.020001)
    }
    expect(data.pose(data.length+100).s).toBe(data.length)
    expect(data.pose(-100).s).toBe(0)
  })
  it('preserves islands as polygon holes instead of filling them with water', () => {
    const water=data.features.filter(f=>f.kind==='water')
    expect(water.reduce((count,f)=>count+f.holes.length,0)).toBe(47)
    const polygon={...water[0],bounds:[0,0,10,10] as [number,number,number,number],coordinates:[{x:0,z:0},{x:10,z:0},{x:10,z:10},{x:0,z:10}],holes:[[{x:4,z:4},{x:6,z:4},{x:6,z:6},{x:4,z:6}]]}
    expect(contains(polygon,2,2)).toBe(true); expect(contains(polygon,5,5)).toBe(false)
  })
})
