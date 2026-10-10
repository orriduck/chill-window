import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { prepareDistantBuildings } from './GeoDistantBuildings'
import type { MappedFeature, MappedBuildingPart } from './GeoData'

const footprint = (id: string, x = 0): MappedFeature => ({ id, kind: 'building', tags: {},
  coordinates: [{ x, z: 0 }, { x: x + 10, z: 0 }, { x: x + 10, z: 10 }, { x, z: 10 }],
  holes: [], bounds: [x, 0, x + 10, 10], buildingHeight: { metres: null, status: 'missing', method: null } })

describe('source-backed distant building geometry', () => {
  it('keeps courtyard holes, raised walls and outward triangle normals in indexed batches', () => {
    const source = footprint('raised-courtyard')
    source.holes = [[{ x: 2, z: 2 }, { x: 8, z: 2 }, { x: 8, z: 8 }, { x: 2, z: 8 }]]
    source.buildingHeight = { metres: 12, status: 'source_tag', method: 'source height' }
    source.overtureProperties = { min_height: 3 }
    const original = JSON.stringify(source)
    const distant = prepareDistantBuildings({ features: [source], buildingParts: [] }, { groundAt: () => 100 })
    let roofArea = 0
    for (const object of distant.group.children) {
      const mesh = object as THREE.Mesh, geometry = mesh.geometry
      const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal'), centers = geometry.getAttribute('geoBuildingCenter'), index = geometry.index!
      expect(centers.count).toBe(positions.count)
      for (let i = 0; i < positions.count; i++) {
        expect(positions.getY(i)).toBeGreaterThanOrEqual(102.89)
        expect(centers.getX(i)).toBe(5); expect(centers.getY(i)).toBe(5)
      }
      for (let i = 0; i < index.count; i += 3) {
        const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
        expect(Math.max(...ids)).toBeLessThan(positions.count)
        const [a, b, c] = ids.map(id => new THREE.Vector3().fromBufferAttribute(positions, id))
        const face = b.sub(a).cross(c.sub(a))
        const normal = new THREE.Vector3().fromBufferAttribute(normals, ids[0])
        expect(face.dot(normal)).toBeGreaterThan(0)
        if (normal.y > 0.9) roofArea += face.length() / 2
      }
    }
    expect(roofArea).toBeCloseTo(64, 5)
    expect(JSON.stringify(source)).toBe(original)
    distant.dispose()
  })
  it('keeps missing-height footprints flat, shelters open and parts at their source min_height', () => {
    const unknown = footprint('unknown'), shelter = footprint('open-canopy', 20)
    shelter.tags = { building: 'yes', amenity: 'shelter' }
    const part: MappedBuildingPart = { ...footprint('raised-part', 40), id: 'raised-part', parentFeatureId: 'parent',
      height: 48, minHeight: 24, roofShape: null, facadeMaterial: 'brick', roofMaterial: null,
      roofColor: null, facadeColor: null, sourceDatasets: ['OpenStreetMap'], sourceRecordIds: ['w1@1'] }
    const distant = prepareDistantBuildings({ features: [unknown, shelter], buildingParts: [part] }, { groundAt: () => 100 })
    const meshes = distant.group.children as THREE.Mesh[]
    const unknownMesh = meshes.find(mesh => mesh.userData.geoSourceIds.includes('unknown'))!
    const shelterMesh = meshes.find(mesh => mesh.userData.geoStructureKind === 'open-shelter')!
    const partMesh = meshes.find(mesh => mesh.userData.geoStructureKind === 'part')!
    for (const [mesh, low, high] of [[unknownMesh, 100.12, 100.12], [shelterMesh, 103.6, 103.6], [partMesh, 124, 148]] as const) {
      const positions = mesh.geometry.getAttribute('position'), ys = Array.from({ length: positions.count }, (_, i) => positions.getY(i))
      expect(Math.min(...ys)).toBeCloseTo(low, 4); expect(Math.max(...ys)).toBeCloseTo(high, 4)
    }
    expect(distant.stats).toMatchObject({ extruded: 0, openShelters: 1, parts: 1 })
    distant.dispose()
  })
})
