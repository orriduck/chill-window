import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GeoData, type BuildingOverlaySnapshot, type GeoBundle } from './GeoData'
import { prepareDistantBuildings } from './GeoDistantBuildings'

describe('whole Hudson source geometry coverage', () => {
  it('builds the real Hudson building overlay and reports geometry cost', () => {
    const base = new URL('../../../../public/geodata/hudson/', import.meta.url)
    const world = JSON.parse(readFileSync(new URL('world.json', base), 'utf8')) as GeoBundle
    const overlay = JSON.parse(readFileSync(new URL('buildings.json', base), 'utf8')) as BuildingOverlaySnapshot
    const demBuffer = readFileSync(new URL(world.dem.file, base))
    const demBytes = demBuffer.buffer.slice(demBuffer.byteOffset, demBuffer.byteOffset + demBuffer.byteLength)
    const data = new GeoData(world, new Float32Array(demBytes), undefined, overlay)
    const distant = prepareDistantBuildings(data, { groundAt: (x, z) => data.heightAt(x, z), isWater: (x, z) => data.landAt(x, z, 'water') })
    console.log('DISTANT_BUILDING_COST', JSON.stringify(distant.stats))
    expect(distant.stats.components).toBe(34326)
    expect(distant.stats.regions).toBeGreaterThan(1)
    for (const child of distant.group.children) {
      const mesh = child as import('three').Mesh
      const position = mesh.geometry.getAttribute('position')
      const center = mesh.geometry.getAttribute('geoBuildingCenter')
      const indices = mesh.geometry.getIndex()!
      expect(center.count).toBe(position.count)
      expect(indices.count % 3).toBe(0)
      let valid = true
      for (let i = 0; i < indices.count; i++) if (indices.getX(i) >= position.count) { valid = false; break }
      for (let i = 0; i < position.count; i++) {
        if (!Number.isFinite(position.getX(i) + position.getY(i) + position.getZ(i)) || !Number.isFinite(center.getX(i) + center.getY(i))) { valid = false; break }
      }
      expect(valid).toBe(true)
    }
    distant.dispose()
  })
})
