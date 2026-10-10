/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { GeoLandCover, type LandCoverSnapshot } from './GeoLandCover'

const base = new URL('../../../../public/geodata/hudson/', import.meta.url)
const snapshot = JSON.parse(readFileSync(new URL('landcover.json', base), 'utf8')) as LandCoverSnapshot & {
  pixelChecks: Array<{ class: number; pixel: [number, number] }>
}
const classes = new Uint8Array(readFileSync(new URL('landcover.u8', base)))
const land = new GeoLandCover(snapshot, classes)

describe('retained USGS categorical source', () => {
  it('binds the complete classification bytes to the retained route snapshot', () => {
    const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
    expect(digest(classes)).toBe(snapshot.sha256)
    expect(digest(readFileSync(new URL('world.json', base)))).toBe(snapshot.baseWorldSha256)
    expect(classes.length).toBe(498560)
    const observed: Record<string, number> = {}
    for (const code of classes) observed[code] = (observed[code] ?? 0) + 1
    expect(observed).toEqual(snapshot.classCounts)
  })
  it('places independently queried forest, water and developed pixels with north-to-south row order', () => {
    const [west, south, east, north] = snapshot.bounds
    for (const { pixel: [column, row], class: code } of snapshot.pixelChecks) {
      const x = west + (column + 0.5) * (east - west) / snapshot.width
      const z = north - (row + 0.5) * (north - south) / snapshot.height
      expect(land.sample(x, z)).toBe(code)
    }
    expect(land.sample(west - 1, north)).toBeNull()
    expect(land.sample(east, south - 1)).toBeNull()
    expect(land.sample(Number.NaN, north)).toBeNull()
  })
})
