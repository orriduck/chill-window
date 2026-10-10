import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { corridorBuildingCatalogSha256, corridorBuildingCatalogUrl, corridorBuildingIds, corridorBuildingTotal } from './GeoCorridorBuildingRecords'

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
  readonly textures = new Set<THREE.Texture>()
  readonly stats = { modelBytes: 0, textureBytes: 0, textures: 0 }
  private root = new URL('./', new URL(corridorBuildingCatalogUrl, location.href))
  private manager = new THREE.LoadingManager()

  private url(uri: string) {
    const url = new URL(uri, this.root)
    if (!url.href.startsWith(this.root.href)) throw new Error('建筑资产路径越出已校验目录')
    return url
  }

  private async checkedFetch(url: URL, expectedSha: string, expectedBytes?: number) {
    const response = await fetch(url.href, { signal: this.abort.signal })
    if (!response.ok) throw new Error(`沿线建筑下载失败 ${response.status}: ${url.pathname}`)
    const bytes = await response.arrayBuffer()
    const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('')
    if (sha !== expectedSha || (expectedBytes !== undefined && bytes.byteLength !== expectedBytes)) throw new Error(`沿线建筑来源校验失败: ${url.pathname}`)
    if (this.disposed) throw new Error('建筑资产加载已取消')
    return bytes
  }

  async prepare(): Promise<CorridorBuildingCatalog> {
    const bytes = await this.checkedFetch(new URL(corridorBuildingCatalogUrl, location.href), corridorBuildingCatalogSha256)
    const catalog: CorridorBuildingCatalog = JSON.parse(new TextDecoder().decode(bytes))
    const ids = catalog.tiles.flatMap(tile => tile.records.map(record => record.sourceId))
    const expectedIds = new Set(corridorBuildingIds)
    if (catalog.schemaVersion !== 1 || catalog.totalBuildings !== corridorBuildingTotal || catalog.tiles.length !== 415 || catalog.textures.length !== 16
      || ids.length !== expectedIds.size || new Set(ids).size !== ids.length || ids.some(id => !expectedIds.has(id))
      || catalog.worldSha256 !== 'c4a2eaea1d1ffc3d1f9c346dcceb812f10a4efb9755da146d4c18249002393ec'
      || catalog.buildingsOverlaySha256 !== '0d5bd68c040b42f99138fbdb768167ef22e8c48b5442fe0bf7d889f7347bd54f') throw new Error('沿线建筑清单与真实地理来源不匹配')
    await Promise.all(catalog.textures.map(async image => {
      const url = this.url(image.uri)
      const imageBytes = await this.checkedFetch(url, image.sha256, image.bytes)
      const decoded = await createImageBitmap(new Blob([imageBytes], { type: image.mimeType }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
      if (this.disposed) { decoded.close(); throw new Error('建筑图片加载已取消') }
      const texture = new THREE.Texture(decoded)
      texture.flipY = false; texture.needsUpdate = true
      this.sources.set(url.href, texture); this.textures.add(texture); this.images.add(decoded)
      this.stats.textureBytes += imageBytes.byteLength; this.stats.textures++
    }))
    if (this.stats.textureBytes !== catalog.textureBytes) throw new Error('建筑共享图片字节统计不一致')
    const owner = this
    class SharedTextureLoader extends THREE.Loader<THREE.Texture> {
      override load(url: string, onLoad?: (texture: THREE.Texture) => void, _onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void) {
        const source = owner.sources.get(new URL(url, location.href).href)
        if (!source || owner.disposed) {
          const error = new Error(`建筑引用未经校验的共享图片: ${url}`)
          queueMicrotask(() => onError?.(error))
          return new THREE.Texture()
        }
        const texture = source.clone()
        texture.needsUpdate = true; owner.textures.add(texture)
        queueMicrotask(() => onLoad?.(texture))
        return texture
      }
    }
    this.manager.addHandler(/(?:\.png|\.jpg)$/i, new SharedTextureLoader(this.manager))
    return catalog
  }

  async loadTile(tile: CorridorBuildingTile) {
    const url = this.url(tile.uri)
    const bytes = await this.checkedFetch(url, tile.sha256, tile.bytes)
    this.stats.modelBytes += bytes.byteLength
    // LoadingManager matches glTF's relative source URI and then receives the
    // fully resolved URL. No image download occurs during any tile parse.
    return new GLTFLoader(this.manager).parseAsync(bytes, new URL('./', url).href)
  }

  dispose() {
    this.disposed = true; this.abort.abort()
    this.textures.forEach(texture => texture.dispose()); this.textures.clear()
    this.images.forEach(image => image.close()); this.images.clear(); this.sources.clear()
  }
}
