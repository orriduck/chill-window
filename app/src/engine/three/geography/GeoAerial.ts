import * as THREE from 'three'
import type { GeoData } from './GeoData'
import { GeoCorridorImagery, corridorShader } from './GeoCorridorImagery'

const ROOT = '/geodata/hudson/imagery/'
const MANIFEST_SHA = 'a67507523459ee79658d46ba7e8c659c105b78ce72fdf4068145007b810c08aa'
const IMAGE_SHA = 'b52faa3730355e2c11ffa9599ad6a311e84fc3dac647d63151eac60b8e2355e0'
interface AerialSnapshot {
  sceneRaster: { filename: string; crs: string; boundsMercator: [number, number, number, number]; sizePixels: [number, number]; bytes: number; sha256: string }
  source: { acquisitionDateFromTileName: string; sourceSha256: string }
}
const digest = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('')
const inverseMercator = (x: number, y: number): [number, number] => [x / 6378137 * 180 / Math.PI, (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180 / Math.PI]

/** The original RGB orthophoto is warped to Mercator in the cloud. Mapping
 * UTM crop bounds directly onto the ride would introduce rotation/offset.
 * Image, shaders and texture upload participate in initial world preparation.
 * Later toggles change a uniform; they never replace geographic geometry. */
export class GeoAerial {
  readonly ready: Promise<void>
  readonly corridor: GeoCorridorImagery
  readonly focusPoint = new THREE.Vector3()
  readonly stats = { ready: false, enabled: true, bytes: 0, width: 0, height: 0, areaMetresSquared: 0, date: '2022-10-22' }
  readonly uniforms = {
    geoAerial: { value: new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1) as THREE.Texture },
    geoAerialBounds: { value: new THREE.Vector4(0, 0, 1, 1) },
    geoAerialEnabled: { value: 0 },
  }
  private installed = new WeakSet<THREE.Material>()
  private disposed = false
  constructor(data: GeoData, groundAt: (x: number, z: number) => number | null) {
    this.uniforms.geoAerial.value.needsUpdate = true
    this.corridor = new GeoCorridorImagery(data)
    this.ready = Promise.all([this.prepare(data, groundAt), this.corridor.ready]).then(() => {
      if (this.disposed) return
      this.stats.ready = true; this.setEnabled(this.stats.enabled)
    })
  }
  private async prepare(data: GeoData, groundAt: (x: number, z: number) => number | null) {
    const response = await fetch(`${ROOT}scene-raster.json`)
    if (!response.ok) throw new Error(`真实航片来源下载失败 ${response.status}`)
    const bytes = await response.arrayBuffer()
    if (await digest(bytes) !== MANIFEST_SHA) throw new Error('真实航片来源记录校验失败')
    const snapshot = JSON.parse(new TextDecoder().decode(bytes)) as AerialSnapshot
    const raster = snapshot.sceneRaster
    if (raster.crs !== 'EPSG:3857' || raster.filename !== 'peekskill-naip-2022-scene.png' || raster.sha256 !== IMAGE_SHA || raster.bytes !== 978340 || raster.boundsMercator.length !== 4 || !raster.boundsMercator.every(Number.isFinite)) throw new Error('真实航片空间记录无效')
    const [west, south, east, north] = raster.boundsMercator
    const low = data.project(inverseMercator(west, south)), high = data.project(inverseMercator(east, north))
    if (low.x >= high.x || low.z >= high.z) throw new Error('真实航片覆盖范围无效')
    const imageResponse = await fetch(`${ROOT}${raster.filename}`)
    if (!imageResponse.ok) throw new Error(`真实航片下载失败 ${imageResponse.status}`)
    const imageBytes = await imageResponse.arrayBuffer()
    if (imageBytes.byteLength !== raster.bytes || await digest(imageBytes) !== IMAGE_SHA) throw new Error('真实航片图像校验失败')
    const url = URL.createObjectURL(new Blob([imageBytes], { type: 'image/png' }))
    let texture: THREE.Texture
    try { texture = await new THREE.TextureLoader().loadAsync(url) } finally { URL.revokeObjectURL(url) }
    if (this.disposed) { texture.dispose(); return }
    const image = texture.image as HTMLImageElement
    if (image.width !== raster.sizePixels[0] || image.height !== raster.sizePixels[1]) { texture.dispose(); throw new Error('真实航片像素尺寸不匹配') }
    // Three's WebGL SRGB8_ALPHA8 upload decodes to linear on sampling. No
    // extra gamma conversion or invented green tint is applied to this RGB.
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
    texture.anisotropy = 4
    texture.needsUpdate = true
    this.uniforms.geoAerial.value.dispose(); this.uniforms.geoAerial.value = texture
    this.uniforms.geoAerialBounds.value.set(low.x, low.z, high.x, high.z)
    const x = (low.x + high.x) / 2, z = (low.z + high.z) / 2
    this.focusPoint.set(x, groundAt(x, z) ?? 0, z)
    this.stats.bytes = imageBytes.byteLength
    this.stats.width = raster.sizePixels[0]; this.stats.height = raster.sizePixels[1]
    this.stats.areaMetresSquared = (high.x - low.x) * (high.z - low.z)
    this.stats.date = snapshot.source.acquisitionDateFromTileName
  }
  setEnabled(enabled: boolean) { this.stats.enabled = enabled; this.uniforms.geoAerialEnabled.value = this.stats.ready && enabled ? 1 : 0 }
  install(material: THREE.MeshStandardMaterial, roofOnly = false) {
    if (this.installed.has(material)) return
    this.installed.add(material)
    const previous = material.onBeforeCompile, previousKey = material.customProgramCacheKey.bind(material)
    const key = previousKey()
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer)
      Object.assign(shader.uniforms, this.uniforms)
      Object.assign(shader.uniforms, this.corridor.uniforms)
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 geoAerialPosition;\nvarying float geoAerialUp;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ngeoAerialPosition = position; geoAerialUp = normal.y;')
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nuniform sampler2D geoAerial;\nuniform vec4 geoAerialBounds;\nuniform float geoAerialEnabled;\nvarying vec3 geoAerialPosition;\nvarying float geoAerialUp;\n${corridorShader}`)
        .replace('#include <roughnessmap_fragment>', `
if (geoAerialEnabled > 0.5${roofOnly ? ' && geoAerialUp > 0.55' : ''}) {
  vec4 source = geographicCorridorSample(geoAerialPosition.xz);
  diffuseColor.rgb = mix(diffuseColor.rgb, source.rgb, source.a);
}
vec2 aerialUv = (geoAerialPosition.xz - geoAerialBounds.xy) / (geoAerialBounds.zw - geoAerialBounds.xy);
if (geoAerialEnabled > 0.5 && all(greaterThanEqual(aerialUv, vec2(0.0))) && all(lessThanEqual(aerialUv, vec2(1.0)))${roofOnly ? ' && geoAerialUp > 0.55' : ''}) {
  vec3 aerialRgb = texture2D(geoAerial, aerialUv).rgb;
  vec2 edgeMetres = min(aerialUv, vec2(1.0) - aerialUv) * (geoAerialBounds.zw - geoAerialBounds.xy);
  // The RGB warp's out-of-crop pixels are zero. Keep their original terrain
  // rather than painting a black border. Feather only the crop boundary.
  float cover = step(0.0001, max(aerialRgb.r, max(aerialRgb.g, aerialRgb.b))) * smoothstep(0.0, 8.0, min(edgeMetres.x, edgeMetres.y));
  diffuseColor.rgb = mix(diffuseColor.rgb, aerialRgb, cover);
}
#include <roughnessmap_fragment>`)
    }
    material.customProgramCacheKey = () => `${key}-real-naip-${roofOnly ? 'roof' : 'ground'}-v2-corridor`
    material.needsUpdate = true
  }
  dispose() { this.disposed = true; this.uniforms.geoAerial.value.dispose(); this.corridor.dispose() }
}
