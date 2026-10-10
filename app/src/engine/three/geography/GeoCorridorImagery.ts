import * as THREE from 'three'
import type { GeoData } from './GeoData'

const ROOT = '/geodata/hudson/imagery/corridor/'
const MANIFEST_SHA = '6c7f48d7e977b64886f3d491153b2fab9d4e943be89d134433ca66a04ac15d57'
const IMAGES = [
  { file: 'scene-atlas-00.png', bytes: 11185793, sha: 'ef06cfec65274fa9a271455d54e123b511e5887d1294fd40ade20cba55e2be33' },
  { file: 'scene-atlas-01.png', bytes: 14002055, sha: '569a28283c8c027bc3dd69bb0166f0876bced85578a1eb4cfb517887929af89c' },
  { file: 'scene-atlas-02.png', bytes: 10535235, sha: '34aba2fd3c96dfc4441c9e7ec24598e19d112df44cf69c4467faf103ad9ac45e' },
] as const
interface Placement {
  atlasIndex: number
  pixelOffsetInCorridorMosaic: [number, number]
  validSourceSizePx: [number, number]
  contentRectPxFromTopLeft: { x: number; y: number; width: number; height: number }
  bounds3857: [number, number, number, number]
  maskBoundaryAndNodata: { coveragePixelCount: number }
}
interface Manifest {
  worldJsonSha256: string
  blockCount: number
  processing: { epsg: string; contentPx: number; paddingPx: number }
  atlases: Array<{ atlasIndex: number; image: { path: string; bytes: number; sha256: string }; sizePx: [number, number]; placements: Placement[] }>
}
const digest = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('')
const inverseMercator = (x: number, y: number): [number, number] => [x / 6378137 * 180 / Math.PI, (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180 / Math.PI]
const placeholder = () => {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1)
  texture.needsUpdate = true; return texture as THREE.Texture
}

/** Actual source RGB/mask atlas prepared and verified outside the browser.
 * Lookup cells describe geographic tiles, never a generated terrain layout.
 * All textures load before the existing world GPU preparation/ride gate. */
export class GeoCorridorImagery {
  readonly ready: Promise<void>
  readonly stats = { ready: false, bytes: 0, blocks: 0, areaMetresSquared: 0, atlases: 3, groundSampleMetres: 2.4 }
  readonly uniforms = {
    geoCorridor0: { value: placeholder() }, geoCorridor1: { value: placeholder() }, geoCorridor2: { value: placeholder() },
    geoCorridorLookup: { value: placeholder() },
    geoCorridorGrid: { value: new THREE.Vector4(0, 0, 1, 1) },
    geoCorridorGridSize: { value: new THREE.Vector2(1, 1) },
  }
  private disposed = false
  constructor(data: GeoData) { this.ready = this.prepare(data) }

  private async prepare(data: GeoData) {
    const response = await fetch(`${ROOT}scene-atlases.json`)
    if (!response.ok) throw new Error(`全线航片来源下载失败 ${response.status}`)
    const bytes = await response.arrayBuffer()
    if (await digest(bytes) !== MANIFEST_SHA) throw new Error('全线航片来源记录校验失败')
    const manifest = JSON.parse(new TextDecoder().decode(bytes)) as Manifest
    if (manifest.worldJsonSha256 !== 'c4a2eaea1d1ffc3d1f9c346dcceb812f10a4efb9755da146d4c18249002393ec' || manifest.blockCount !== 141
      || manifest.processing.epsg !== 'EPSG:3857' || manifest.processing.contentPx !== 427 || manifest.processing.paddingPx !== 2 || manifest.atlases.length !== 3) throw new Error('全线航片空间来源不匹配')
    const placements = manifest.atlases.flatMap(atlas => atlas.placements)
    if (placements.length !== 141) throw new Error('全线航片区块数量不匹配')
    const cols = Math.max(...placements.map(item => item.pixelOffsetInCorridorMosaic[0] / 427)) + 1
    const rows = Math.max(...placements.map(item => item.pixelOffsetInCorridorMosaic[1] / 427)) + 1
    const first = placements[0], col0 = first.pixelOffsetInCorridorMosaic[0] / 427, row0 = first.pixelOffsetInCorridorMosaic[1] / 427
    const west = first.bounds3857[0] - col0 * 1024.8, north = first.bounds3857[3] + row0 * 1024.8
    const origin = data.project(inverseMercator(west, north)), adjacent = data.project(inverseMercator(west + 1024.8, north - 1024.8))
    const span = new THREE.Vector2(adjacent.x - origin.x, origin.z - adjacent.z)
    const pixels = new Float32Array(cols * rows * 4)
    let coveragePixels = 0
    for (const tile of placements) {
      const col = tile.pixelOffsetInCorridorMosaic[0] / 427, row = tile.pixelOffsetInCorridorMosaic[1] / 427
      const rect = tile.contentRectPxFromTopLeft, valid = tile.validSourceSizePx
      if (!Number.isInteger(col) || !Number.isInteger(row) || rect.width !== 427 || rect.height !== 427 || valid.some(value => value < 1 || value > 427)
        || Math.abs(tile.bounds3857[0] - (west + col * 1024.8)) > 0.001 || Math.abs(tile.bounds3857[3] - (north - row * 1024.8)) > 0.001
        || Math.abs(tile.bounds3857[2] - tile.bounds3857[0] - valid[0] * 2.4) > 0.001 || Math.abs(tile.bounds3857[3] - tile.bounds3857[1] - valid[1] * 2.4) > 0.001) throw new Error('全线航片区块边界不匹配')
      const index = (row * cols + col) * 4
      if (pixels[index] !== 0) throw new Error('全线航片区块重复')
      pixels.set([tile.atlasIndex + 1, rect.x, rect.y, valid[0] * 512 + valid[1]], index)
      coveragePixels += tile.maskBoundaryAndNodata.coveragePixelCount
    }
    const lookup = new THREE.DataTexture(pixels, cols, rows, THREE.RGBAFormat, THREE.FloatType)
    lookup.minFilter = lookup.magFilter = THREE.NearestFilter; lookup.generateMipmaps = false; lookup.needsUpdate = true
    const textures = await Promise.all(IMAGES.map(async (image, index) => {
      const record = manifest.atlases[index]
      if (record.atlasIndex !== index || record.image.path !== image.file || record.image.bytes !== image.bytes || record.image.sha256 !== image.sha || record.sizePx.join(',') !== '4096,4096') throw new Error('全线航片图集来源不匹配')
      const response = await fetch(`${ROOT}${image.file}`)
      if (!response.ok) throw new Error(`全线航片图集下载失败 ${response.status}`)
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength !== image.bytes || await digest(bytes) !== image.sha) throw new Error('全线航片图集校验失败')
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
      let texture: THREE.Texture
      try { texture = await new THREE.TextureLoader().loadAsync(url) } finally { URL.revokeObjectURL(url) }
      const decoded = texture.image as HTMLImageElement
      if (decoded.width !== 4096 || decoded.height !== 4096) throw new Error('全线航片图集尺寸不匹配')
      texture.colorSpace = THREE.SRGBColorSpace
      texture.premultiplyAlpha = true
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
      texture.minFilter = THREE.LinearMipmapLinearFilter; texture.anisotropy = 1
      texture.needsUpdate = true
      return texture
    }))
    if (this.disposed) { lookup.dispose(); textures.forEach(texture => texture.dispose()); return }
    for (const [index, name] of ['geoCorridor0', 'geoCorridor1', 'geoCorridor2'].entries()) {
      const uniform = this.uniforms[name as 'geoCorridor0' | 'geoCorridor1' | 'geoCorridor2']
      uniform.value.dispose(); uniform.value = textures[index]
    }
    this.uniforms.geoCorridorLookup.value.dispose(); this.uniforms.geoCorridorLookup.value = lookup
    this.uniforms.geoCorridorGrid.value.set(origin.x, origin.z, span.x, span.y)
    this.uniforms.geoCorridorGridSize.value.set(cols, rows)
    this.stats.ready = true; this.stats.blocks = placements.length
    this.stats.bytes = IMAGES.reduce((sum, image) => sum + image.bytes, 0)
    this.stats.areaMetresSquared = coveragePixels * span.x * span.y / (427 * 427)
  }

  dispose() {
    this.disposed = true
    for (const uniform of [this.uniforms.geoCorridor0, this.uniforms.geoCorridor1, this.uniforms.geoCorridor2, this.uniforms.geoCorridorLookup]) uniform.value.dispose()
  }
}

export const corridorShader = `
uniform sampler2D geoCorridor0;
uniform sampler2D geoCorridor1;
uniform sampler2D geoCorridor2;
uniform sampler2D geoCorridorLookup;
uniform vec4 geoCorridorGrid;
uniform vec2 geoCorridorGridSize;
vec4 geographicCorridorSample(vec2 world) {
  vec2 grid = vec2(world.x - geoCorridorGrid.x, geoCorridorGrid.y - world.y) / geoCorridorGrid.zw;
  // Derivatives come from continuous geographic coordinates, before floor,
  // lookup and sampler branches. Atlas offsets must never select the mip.
  vec2 gradX = dFdx(grid) * vec2(427.0, -427.0) / 4096.0;
  vec2 gradY = dFdy(grid) * vec2(427.0, -427.0) / 4096.0;
  // Two replicated padding pixels protect mip0/1. Cap the footprint to mip1
  // rather than blending unrelated packed geographic tiles at coarser mips.
  // Distant minification quality still needs actual motion inspection.
  gradX *= min(1.0, (2.0 / 4096.0) / max(length(gradX), 0.0000001));
  gradY *= min(1.0, (2.0 / 4096.0) / max(length(gradY), 0.0000001));
  vec2 cell = floor(grid);
  if (any(lessThan(cell, vec2(0.0))) || any(greaterThanEqual(cell, geoCorridorGridSize))) return vec4(0.0);
  vec4 entry = texture2D(geoCorridorLookup, (cell + 0.5) / geoCorridorGridSize);
  if (entry.r < 0.5) return vec4(0.0);
  vec2 pixel = fract(grid) * 427.0;
  vec2 valid = vec2(floor(entry.a / 512.0), mod(entry.a, 512.0));
  if (any(greaterThanEqual(pixel, valid))) return vec4(0.0);
  vec2 uv = vec2(entry.g + pixel.x, 4096.0 - entry.b - pixel.y) / 4096.0;
  vec4 source;
  if (entry.r < 1.5) source = textureGrad(geoCorridor0, uv, gradX, gradY);
  else if (entry.r < 2.5) source = textureGrad(geoCorridor1, uv, gradX, gradY);
  else source = textureGrad(geoCorridor2, uv, gradX, gradY);
  source.rgb /= max(source.a, 0.0001);
  return source;
}`
