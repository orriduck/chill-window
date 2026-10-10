import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { corridorBuildingCatalogSha256, corridorBuildingCatalogUrl, corridorBuildingIds, corridorBuildingTotal } from './GeoCorridorBuildingRecords'
import { corridorBuildingPackIndexSha256, corridorBuildingPackIndexUrl } from './GeoCorridorBuildingPackRecords'
import { buildingBytesSha256, validateBuildingPackIndex, type BuildingPackEntry, type BuildingPackIndex } from './GeoBuildingPack'

export interface CorridorBuildingRecord {
  sourceId: string; transportId: string; heightMetres: number
  heightStatus: 'source_tag' | 'source_estimate'; openRoof: boolean
}
export interface CorridorBuildingTile {
  uri: string; sha256: string; bytes: number; origin: [number, number]
  records: CorridorBuildingRecord[]
}
export interface CorridorBuildingCatalog {
  schemaVersion: 1; worldSha256: string; buildingsOverlaySha256: string
  tiles: CorridorBuildingTile[]
  textures: { uri: string; sha256: string; bytes: number; mimeType: string }[]
  totalBuildings: number; modelBytes: number; textureBytes: number
  sourceTags: number; sourceEstimates: number; openRoofs: number
}

/** Own one decoded image Source per content-addressed file. Individual glTF
 * textures still get their own UV transforms, samplers and colour spaces. */
export class GeoCorridorBuildingAssets {
  private abort = new AbortController()
  private sources = new Map<string, THREE.Texture>()
  private images = new Set<ImageBitmap>()
  private disposed = false
  private pack: ArrayBuffer | null = null
  private entries = new Map<string, BuildingPackEntry>()
  private claimed = new Set<string>()
  private parseStartedAt: number | null = null
  private preparation: Promise<CorridorBuildingCatalog> | null = null
  readonly textures = new Set<THREE.Texture>()
  readonly stats = { transportMode: 'lossless-pack-v1', modelRequests: 0, downloadedModelBytes: 0, packVerified: false,
    slicesVerified: 0, slicesParsed: 0, retainedPackBytes: 0, downloadMs: 0, packHashMs: 0, sliceHashMs: 0, parseMs: 0, parseWallMs: 0,
    modelBytes: 0, textureBytes: 0, textures: 0 }
  private root = new URL('./', new URL(corridorBuildingCatalogUrl, location.href))
  private manager = new THREE.LoadingManager()

  private url(uri: string) {
    const url = new URL(uri, this.root)
    if (!url.href.startsWith(this.root.href)) throw new Error('建筑资产路径越出已校验目录')
    return url
  }

  private async checkedFetch(url: URL, expectedSha: string, expectedBytes?: number, model = false) {
    if (this.disposed) throw new DOMException('建筑资产加载已取消', 'AbortError')
    const started = performance.now()
    if (model) this.stats.modelRequests++
    const response = await fetch(url.href, { signal: this.abort.signal })
    if (!response.ok) throw new Error(`沿线建筑下载失败 ${response.status}: ${url.pathname}`)
    const bytes = await response.arrayBuffer()
    if (model) { this.stats.downloadMs = performance.now() - started; this.stats.downloadedModelBytes = bytes.byteLength }
    const hashStarted = performance.now()
    const sha = await buildingBytesSha256(bytes)
    if (model) this.stats.packHashMs = performance.now() - hashStarted
    if (sha !== expectedSha || (expectedBytes !== undefined && bytes.byteLength !== expectedBytes)) throw new Error(`沿线建筑来源校验失败: ${url.pathname}`)
    if (this.disposed) throw new DOMException('建筑资产加载已取消', 'AbortError')
    return bytes
  }

  prepare(): Promise<CorridorBuildingCatalog> {
    this.preparation ??= this.prepareAssets().catch(error => { this.dispose(); throw error })
    return this.preparation
  }

  private async prepareAssets(): Promise<CorridorBuildingCatalog> {
    const bytes = await this.checkedFetch(new URL(corridorBuildingCatalogUrl, location.href), corridorBuildingCatalogSha256)
    const catalog: CorridorBuildingCatalog = JSON.parse(new TextDecoder().decode(bytes))
    const ids = catalog.tiles.flatMap(tile => tile.records.map(record => record.sourceId))
    const expectedIds = new Set(corridorBuildingIds)
    if (catalog.schemaVersion !== 1 || catalog.totalBuildings !== corridorBuildingTotal || catalog.tiles.length !== 415 || catalog.textures.length !== 16
      || ids.length !== expectedIds.size || new Set(ids).size !== ids.length || ids.some(id => !expectedIds.has(id))
      || catalog.worldSha256 !== 'c4a2eaea1d1ffc3d1f9c346dcceb812f10a4efb9755da146d4c18249002393ec'
      || catalog.buildingsOverlaySha256 !== '0d5bd68c040b42f99138fbdb768167ef22e8c48b5442fe0bf7d889f7347bd54f') throw new Error('沿线建筑清单与真实地理来源不匹配')
    const indexBytes = await this.checkedFetch(new URL(corridorBuildingPackIndexUrl, location.href), corridorBuildingPackIndexSha256)
    const index: BuildingPackIndex = JSON.parse(new TextDecoder().decode(indexBytes))
    this.entries = validateBuildingPackIndex(index, catalog)
    const packReady = this.checkedFetch(this.url(index.pack.uri), index.pack.sha256, index.pack.bytes, true).then(packed => {
      if (this.disposed) throw new DOMException('建筑资产加载已取消', 'AbortError')
      this.pack = packed; this.stats.retainedPackBytes = packed.byteLength; this.stats.packVerified = true
    })
    await Promise.all([packReady, ...catalog.textures.map(async image => {
      const url = this.url(image.uri)
      const imageBytes = await this.checkedFetch(url, image.sha256, image.bytes)
      const decoded = await createImageBitmap(new Blob([imageBytes], { type: image.mimeType }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
      if (this.disposed) { decoded.close(); throw new Error('建筑图片加载已取消') }
      const texture = new THREE.Texture(decoded)
      texture.flipY = false; texture.needsUpdate = true
      this.sources.set(url.href, texture); this.textures.add(texture); this.images.add(decoded)
      this.stats.textureBytes += imageBytes.byteLength; this.stats.textures++
    })])
    if (this.disposed) throw new DOMException('建筑资产加载已取消', 'AbortError')
    if (this.stats.textureBytes !== catalog.textureBytes) throw new Error('建筑共享图片字节统计不一致')
    const sources = this.sources, textures = this.textures, isDisposed = () => this.disposed
    class SharedTextureLoader extends THREE.Loader<THREE.Texture> {
      override load(url: string, onLoad?: (texture: THREE.Texture) => void, _onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void) {
        const source = sources.get(new URL(url, location.href).href)
        if (!source || isDisposed()) {
          const error = new Error(`建筑引用未经校验的共享图片: ${url}`)
          queueMicrotask(() => onError?.(error))
          return new THREE.Texture()
        }
        const texture = source.clone()
        texture.needsUpdate = true; textures.add(texture)
        queueMicrotask(() => onLoad?.(texture))
        return texture
      }
    }
    this.manager.addHandler(/(?:\.png|\.jpg)$/i, new SharedTextureLoader(this.manager))
    return catalog
  }

  async loadTile(tile: CorridorBuildingTile) {
    try { return await this.parseTile(tile) }
    catch (error) { this.dispose(); throw error }
  }

  private async parseTile(tile: CorridorBuildingTile) {
    if (this.disposed) throw new DOMException('建筑资产加载已取消', 'AbortError')
    const url = this.url(tile.uri)
    const entry = this.entries.get(tile.uri)
    if (!this.pack || !this.stats.packVerified || !entry || this.claimed.has(tile.uri)
      || entry.sha256 !== tile.sha256 || entry.length !== tile.bytes) throw new Error(`建筑分片未准备或重复解析: ${tile.uri}`)
    this.claimed.add(tile.uri)
    // Only the four caller workers copy one slice each, on demand. No 415-buffer
    // array and no standalone model request or fallback is created.
    const bytes = this.pack.slice(entry.offset, entry.offset + entry.length)
    const hashStarted = performance.now()
    const sha = await buildingBytesSha256(bytes)
    this.stats.sliceHashMs += performance.now() - hashStarted
    if (this.disposed) throw new DOMException('建筑资产加载已取消', 'AbortError')
    if (sha !== tile.sha256 || bytes.byteLength !== tile.bytes) throw new Error(`建筑分片SHA校验失败: ${tile.uri}`)
    this.stats.slicesVerified++
    this.stats.modelBytes += bytes.byteLength
    // LoadingManager matches glTF's relative source URI and then receives the
    // original virtual tile URL directory (including ../textures). No image
    // download occurs during any tile parse. Samplers/UV/colour spaces unchanged.
    const parseStarted = performance.now()
    this.parseStartedAt ??= parseStarted
    const gltf = await new GLTFLoader(this.manager).parseAsync(bytes, new URL('./', url).href)
    this.stats.parseMs += performance.now() - parseStarted
    if (this.disposed) {
      gltf.scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose()
        }
      })
      throw new DOMException('建筑解析已取消', 'AbortError')
    }
    this.stats.slicesParsed++
    this.stats.parseWallMs = performance.now() - this.parseStartedAt
    if (this.stats.slicesParsed === this.entries.size) this.releasePack()
    return gltf
  }

  private releasePack() {
    this.pack = null; this.entries.clear(); this.claimed.clear(); this.stats.retainedPackBytes = 0
  }

  dispose() {
    this.disposed = true; this.abort.abort()
    this.releasePack()
    this.textures.forEach(texture => texture.dispose()); this.textures.clear()
    this.images.forEach(image => image.close()); this.images.clear(); this.sources.clear()
  }
}
