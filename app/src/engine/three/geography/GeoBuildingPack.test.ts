import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { validateBuildingPackIndex, type BuildingPackIndex } from './GeoBuildingPack'
import type { CorridorBuildingCatalog } from './GeoCorridorBuildingAssets'
import { corridorBuildingCatalogSha256 } from './GeoCorridorBuildingRecords'
import { corridorBuildingPackIndexSha256, corridorBuildingPackSha256 } from './GeoCorridorBuildingPackRecords'

const root = new URL('../../../../public/models/osm2world/hudson/', import.meta.url)
const read = (uri: string) => readFileSync(new URL(uri, root))
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const catalog: CorridorBuildingCatalog = JSON.parse(read('catalog.json').toString())
const index: BuildingPackIndex = JSON.parse(read('buildings.pack.index.json').toString())

describe('delivered lossless building transport', () => {
  it('covers all original bytes and catalog hashes with unchanged GLBs and standalone texture paths', () => {
    expect(sha(read('catalog.json'))).toBe(corridorBuildingCatalogSha256)
    expect(sha(read('buildings.pack.index.json'))).toBe(corridorBuildingPackIndexSha256)
    const pack = read('buildings.pack.bin')
    expect(sha(pack)).toBe(corridorBuildingPackSha256)
    expect(pack.byteLength).toBe(25160336)
    const entries = validateBuildingPackIndex(index, catalog)
    expect(entries.size).toBe(415)
    let buildings = 0
    for (const tile of catalog.tiles) {
      const entry = entries.get(tile.uri)!
      const slice = pack.subarray(entry.offset, entry.offset + entry.length)
      expect(slice.equals(read(tile.uri))).toBe(true)
      expect(sha(slice)).toBe(tile.sha256)
      const gltf = JSON.parse(slice.toString('utf8', 20, 20 + slice.readUInt32LE(12)))
      expect(gltf.buffers.every((buffer: { uri?: string }) => !buffer.uri)).toBe(true)
      for (const image of gltf.images ?? []) expect(catalog.textures.map(texture => '../' + texture.uri)).toContain(image.uri)
      buildings += tile.records.length
    }
    expect(buildings).toBe(5853)
    expect(catalog.textures).toHaveLength(16)
    for (const texture of catalog.textures) expect(sha(read(texture.uri))).toBe(texture.sha256)
  })

  it('rejects index tampering before slicing or fetching a model', () => {
    const mutations: ((value: BuildingPackIndex) => void)[] = [
      value => { value.catalogSha256 = '0'.repeat(64) },
      value => { value.pack.sha256 = '0'.repeat(64) },
      value => { value.pack.uri = '../other.bin' },
      value => { value.entries[1].offset++ }, // gap
      value => { value.entries[1].offset-- }, // overlap
      value => { value.entries[1].uri = value.entries[0].uri },
      value => { value.entries[0].offset = Number.MAX_SAFE_INTEGER + 1 },
      value => { value.entries[0].length = -1 },
      value => { value.entries[0].sha256 = '0'.repeat(64) },
      value => { value.entries.pop() },
    ]
    for (const mutate of mutations) {
      const changed = structuredClone(index); mutate(changed)
      expect(() => validateBuildingPackIndex(changed, catalog)).toThrow()
    }
  })
})
