import { corridorBuildingCatalogSha256 } from './GeoCorridorBuildingRecords'
import { corridorBuildingPackSha256 } from './GeoCorridorBuildingPackRecords'
import type { CorridorBuildingCatalog } from './GeoCorridorBuildingAssets'

export interface BuildingPackEntry { uri: string; offset: number; length: number; sha256: string }
export interface BuildingPackIndex {
  formatVersion: 1; catalogSha256: string
  pack: { uri: string; bytes: number; sha256: string }
  entries: BuildingPackEntry[]
}

/** The separate index may only describe the pinned, unchanged source catalog.
 * Reject gaps, overlaps, duplicates, unsafe arithmetic and path rewrites before
 * fetching the buffer or allowing any parser to access a slice. */
export function validateBuildingPackIndex(index: BuildingPackIndex, catalog: CorridorBuildingCatalog) {
  if (index.formatVersion !== 1 || index.catalogSha256 !== corridorBuildingCatalogSha256
    || index.pack?.uri !== 'buildings.pack.bin' || index.pack.sha256 !== corridorBuildingPackSha256
    || !Number.isSafeInteger(index.pack.bytes) || index.pack.bytes !== catalog.modelBytes
    || index.pack.bytes <= 0 || index.pack.bytes > 25 * 1024 * 1024
    || !Array.isArray(index.entries) || index.entries.length !== catalog.tiles.length || index.entries.length !== 415) {
    throw new Error('建筑传输索引与原始清单不匹配')
  }
  const entries = new Map<string, BuildingPackEntry>()
  let offset = 0
  for (let i = 0; i < index.entries.length; i++) {
    const entry = index.entries[i], tile = catalog.tiles[i]
    const end = entry.offset + entry.length
    if (!/^tile--?\d+--?\d+\/buildings\.glb$/.test(entry.uri) || entries.has(entry.uri) || entry.uri !== tile.uri
      || !Number.isSafeInteger(entry.offset) || !Number.isSafeInteger(entry.length) || !Number.isSafeInteger(end)
      || entry.offset !== offset || entry.length <= 0 || entry.length !== tile.bytes || end > index.pack.bytes
      || entry.sha256 !== tile.sha256 || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error(`建筑传输分片范围或来源不匹配: ${entry.uri}`)
    }
    entries.set(entry.uri, entry); offset = end
  }
  if (offset !== index.pack.bytes) throw new Error('建筑传输索引未覆盖全部字节')
  return entries
}

export async function buildingBytesSha256(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('')
}
