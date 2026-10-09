/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { buildingHeight, buildingStructureKind, GeoData, contains, type BuildingOverlaySnapshot, type GeoBundle } from './GeoData'
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
  it('reports source-backed building height coverage without inventing heights', () => {
    expect(data.buildingStats).toEqual({ total: 6302, tagged: 3567, estimated: 9, sourceTag: 0, sourceEstimate: 0, floorsOnly: 0, missing: 2726, shelters: 15, floorTags: 12, roof: 1, parts: 0, added: 0 })
    expect(buildingHeight({ tags: { height: '30 ft' } })).toMatchObject({ status: 'tagged', metres: 9.144 })
    expect(buildingHeight({ tags: { 'building:levels': '2' } })).toMatchObject({ status: 'estimated-from-levels', metres: 6.2 })
    expect(buildingHeight({ tags: { building: 'house' } })).toMatchObject({ status: 'missing', metres: null })
  })
  it('classifies a building-tagged public transport shelter as an open structure', () => {
    const tags = { amenity: 'shelter', building: 'yes', shelter_type: 'public_transport' }
    expect(buildingHeight({ tags })).toMatchObject({ status: 'missing', metres: null })
    expect(buildingStructureKind({ tags, overtureProperties: { class: 'shelter', subtype: 'civic' } })).toBe('open-shelter')
    expect(buildingStructureKind({ tags: { building: 'yes' }, overtureProperties: { class: 'residential' } })).toBe('building')
  })
  it('merges Overture attributes into original OSM geometry and indexes only unmatched additions', () => {
    const source = bundle.features.find(feature => feature.kind === 'building')!
    const overlay = {
      baseWorldSha256: 'snapshot-check-is-performed-by-loader', release: '2026-09-23.1', sources: [],
      stats: { originalOSM: 6302, upstream: 34330, addedBuildings: 1, matched: 6302, heightEnriched: 1, outputComponents: 6303, buildingParts: 0, heightStatus: {} },
      features: [
        { id: source.id, kind: 'building', coordinates: source.coordinates, tags: source.tags, buildingHeight: { metres: 12, status: 'source_tag', method: 'current_osm_height_tag', sources: [{ dataset: 'OpenStreetMap', property: 'height' }] }, provenance: { geometry: { dataset: 'OpenStreetMap', recordId: String(source.id) }, overtureMatches: [{ gersId: 'matched-gers', iou: 0.91, release: '2026-09-23.1' }] }, overtureProperties: { roof_shape: 'gabled', sources: [{ dataset: 'OpenStreetMap', record_id: 'w1@1' }] } },
        { id: 'overture/new-gers', kind: 'building', coordinates: source.coordinates, tags: {}, buildingHeight: { metres: 7, status: 'source_estimate', method: 'upstream_machine_learning', sourceDatasets: ['Microsoft ML Buildings'] }, provenance: { geometry: { dataset: 'Overture Maps', gersId: 'new-gers', release: '2026-09-23.1' }, overtureMatches: [] }, overtureProperties: { sources: [{ dataset: 'Microsoft ML Buildings' }] } },
      ], buildingParts: [],
    } as BuildingOverlaySnapshot
    const withOverlay = new GeoData(bundle, data.elevations, undefined, overlay)
    const mappedOSM = withOverlay.features.find(feature => String(feature.id) === String(source.id))!
    const mappedAddition = withOverlay.features.find(feature => feature.id === 'overture/new-gers')!
    expect(mappedOSM.coordinates).toEqual(data.features.find(feature => String(feature.id) === String(source.id))!.coordinates)
    expect(mappedOSM.tags).toEqual(source.tags)
    expect(buildingHeight(mappedOSM)).toMatchObject({ status: 'source-tag', metres: 12, sources: ['OpenStreetMap'] })
    expect(buildingHeight(mappedAddition)).toMatchObject({ status: 'source-estimate', metres: 7, sources: ['Microsoft ML Buildings'] })
    expect(withOverlay.buildingStats).toMatchObject({ total: 6303, sourceTag: 1, sourceEstimate: 1, added: 1 })
  })
})
