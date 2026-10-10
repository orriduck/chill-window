import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GeoCorridorBuildingAssets } from './GeoCorridorBuildingAssets'

// Browser/GPU parsing is explicitly cloud QA. This mock observes the real
// transport's parser inputs and lifetime without decoding model geometry.
const parser = vi.hoisted(() => ({ parse: vi.fn() }))
vi.mock('three/addons/loaders/GLTFLoader.js', () => ({ GLTFLoader: class {
  parseAsync(bytes: ArrayBuffer, base: string) { return parser.parse(bytes, base) }
} }))
const root = new URL('../../../../public/models/osm2world/hudson/', import.meta.url)
const read = (uri: string) => readFileSync(new URL(uri, root))
let assets: GeoCorridorBuildingAssets
let requests: string[]
let bitmaps: { close: ReturnType<typeof vi.fn> }[]

beforeEach(() => {
  requests = []; bitmaps = []
  vi.stubGlobal('location', { href: 'https://chill.example/' })
  vi.stubGlobal('createImageBitmap', async () => {
    const image = { close: vi.fn() }; bitmaps.push(image); return image
  })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const uri = new URL(url).pathname.replace('/models/osm2world/hudson/', '')
    requests.push(uri)
    if (uri.endsWith('.glb')) throw new Error('Standalone model fetch is forbidden')
    return new Response(new Uint8Array(read(uri)))
  }))
  parser.parse.mockReset(); parser.parse.mockImplementation(async () => ({ scene: new THREE.Group() }))
  assets = new GeoCorridorBuildingAssets()
})
afterEach(() => { assets.dispose(); vi.unstubAllGlobals() })

describe('checked building pack lifetime', () => {
  it('fetches one model transport, hashes 415 bounded slices and keeps original virtual directories', async () => {
    const first = assets.prepare()
    expect(assets.prepare()).toBe(first)
    const catalog = await first
    expect(assets.stats.retainedPackBytes).toBe(25160336)
    let next = 0
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < catalog.tiles.length) await assets.loadTile(catalog.tiles[next++])
    }))
    expect(requests.filter(uri => uri === 'buildings.pack.bin')).toHaveLength(1)
    expect(requests.filter(uri => /\.(png|jpg)$/.test(uri))).toHaveLength(16)
    expect(requests.some(uri => uri.endsWith('.glb'))).toBe(false)
    expect(assets.stats).toMatchObject({ modelRequests: 1, downloadedModelBytes: 25160336, packVerified: true,
      slicesVerified: 415, slicesParsed: 415, modelBytes: 25160336, retainedPackBytes: 0, textureBytes: 4984364 })
    expect(parser.parse).toHaveBeenCalledTimes(415)
    for (const [bytes, base] of parser.parse.mock.calls as [ArrayBuffer, string][]) {
      const uri = new URL('buildings.glb', base).pathname.replace('/models/osm2world/hudson/', '')
      expect(Buffer.from(bytes).equals(read(uri))).toBe(true)
      expect(new URL('../textures/example.png', base).href).toBe('https://chill.example/models/osm2world/hudson/textures/example.png')
    }
    assets.dispose()
    expect(bitmaps).toHaveLength(16)
    for (const bitmap of bitmaps) expect(bitmap.close).toHaveBeenCalledOnce()
  })

  it('rejects a tampered downloaded index before requesting the pack or a texture', async () => {
    const original = fetch
    vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
      if (!url.endsWith('buildings.pack.index.json')) return original(url, options)
      requests.push('buildings.pack.index.json')
      const bytes = new Uint8Array(read('buildings.pack.index.json')); bytes[30] ^= 1
      return new Response(bytes)
    })
    await expect(assets.prepare()).rejects.toThrow('来源校验失败')
    expect(requests).toEqual(['catalog.json', 'buildings.pack.index.json'])
    expect(assets.stats.modelRequests).toBe(0)
    expect(parser.parse).not.toHaveBeenCalled()
  })

  it('fails closed on a corrupt pack and never starts a parser or standalone fetch', async () => {
    const original = fetch
    vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
      if (!url.endsWith('buildings.pack.bin')) return original(url, options)
      requests.push('buildings.pack.bin')
      const bytes = new Uint8Array(read('buildings.pack.bin')); bytes[100] ^= 1
      return new Response(bytes)
    })
    await expect(assets.prepare()).rejects.toThrow('来源校验失败')
    expect(parser.parse).not.toHaveBeenCalled()
    expect(assets.stats.retainedPackBytes).toBe(0)
    expect(assets.textures.size).toBe(0)
    expect(requests.some(uri => uri.endsWith('.glb'))).toBe(false)
  })

  it('aborts a held pack download and clears any already decoded shared images', async () => {
    const original = fetch
    let packRequested!: () => void
    const requested = new Promise<void>(resolve => { packRequested = resolve })
    vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
      if (!url.endsWith('buildings.pack.bin')) return original(url, options)
      packRequested()
      return new Promise<Response>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new DOMException('held download aborted', 'AbortError')), { once: true })
      })
    })
    const ready = assets.prepare()
    const rejection = expect(ready).rejects.toMatchObject({ name: 'AbortError' })
    await requested; assets.dispose(); await rejection
    expect(assets.stats.retainedPackBytes).toBe(0)
    expect(assets.textures.size).toBe(0)
    expect(parser.parse).not.toHaveBeenCalled()
    await Promise.resolve()
    for (const bitmap of bitmaps) expect(bitmap.close).toHaveBeenCalledOnce()
  })

  it('releases pack and disposes a parse that completes after owner cancellation', async () => {
    const catalog = await assets.prepare()
    let finish!: (value: { scene: THREE.Group }) => void
    let started!: () => void
    const begun = new Promise<void>(resolve => { started = resolve })
    parser.parse.mockImplementation(() => { started(); return new Promise(resolve => { finish = resolve }) })
    const scene = new THREE.Group(), geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial()
    scene.add(new THREE.Mesh(geometry, material))
    const geometryDisposed = vi.fn(), materialDisposed = vi.fn()
    geometry.addEventListener('dispose', geometryDisposed); material.addEventListener('dispose', materialDisposed)
    const tile = assets.loadTile(catalog.tiles[0])
    const rejection = expect(tile).rejects.toMatchObject({ name: 'AbortError' })
    await begun; assets.dispose(); finish({ scene }); await rejection
    expect(geometryDisposed).toHaveBeenCalledOnce(); expect(materialDisposed).toHaveBeenCalledOnce()
    expect(assets.stats.retainedPackBytes).toBe(0); expect(assets.stats.slicesParsed).toBe(0)
  })

  it('releases all owned transport/images after a parser error without fallback', async () => {
    const catalog = await assets.prepare()
    parser.parse.mockRejectedValue(new Error('parser failed'))
    await expect(assets.loadTile(catalog.tiles[0])).rejects.toThrow('parser failed')
    expect(assets.stats.retainedPackBytes).toBe(0); expect(assets.textures.size).toBe(0)
    for (const bitmap of bitmaps) expect(bitmap.close).toHaveBeenCalledOnce()
    expect(requests.some(uri => uri.endsWith('.glb'))).toBe(false)
  })
})
