import * as THREE from 'three'

const ROOT = '/models/trees/impostors/'
const MANIFEST_SHA = 'bffe9834d3ddde764c80b79350992039dce2d9a5648849b658920d0edadb2f3c'
interface Atlas { species: string; image: { file: string; bytes: number; sha256: string }; sizePx: [number, number] }
interface Manifest { sourceCommit: string; sourcePixelsUnchanged: boolean; frameCount: number; frameWorldBoundsMetres: number[]; atlases: Atlas[] }
const digest = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('')
const placeholder = () => {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1)
  texture.needsUpdate = true; return texture as THREE.Texture
}

/** Eight fixed camera views of the same authored canopy source meshes.
 * Both atlases load and upload before departure. Camera changes sample the
 * existing images and never create models, textures or geographic positions. */
export class GeoTreeImpostors {
  readonly ready: Promise<void>
  readonly stats = { ready: false, frames: 16, bytes: 0 }
  readonly uniforms = { geoTreeAsh: { value: placeholder() }, geoTreeOak: { value: placeholder() } }
  private disposed = false
  constructor() { this.ready = this.prepare() }
  private async prepare() {
    const response = await fetch(`${ROOT}tree-atlases.json`)
    if (!response.ok) throw new Error(`同源树冠来源下载失败 ${response.status}`)
    const bytes = await response.arrayBuffer()
    if (await digest(bytes) !== MANIFEST_SHA) throw new Error('同源树冠来源校验失败')
    const manifest = JSON.parse(new TextDecoder().decode(bytes)) as Manifest
    if (manifest.sourceCommit !== 'dcf309bd86bd521083d9c70f01f2de45fdc7c457' || !manifest.sourcePixelsUnchanged || manifest.frameCount !== 16
      || manifest.frameWorldBoundsMetres.join(',') !== '-11,-0.5,11,21.5' || manifest.atlases.length !== 2) throw new Error('同源树冠空间记录不匹配')
    const textures = await Promise.all(manifest.atlases.map(async (atlas, index) => {
      if (atlas.species !== ['ash', 'oak'][index] || atlas.image.file !== `${atlas.species}-8-view-atlas.png` || atlas.sizePx.join(',') !== '2048,1024') throw new Error('同源树冠图集记录不匹配')
      const response = await fetch(`${ROOT}${atlas.image.file}`)
      if (!response.ok) throw new Error(`同源树冠图集下载失败 ${response.status}`)
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength !== atlas.image.bytes || await digest(bytes) !== atlas.image.sha256) throw new Error('同源树冠图集校验失败')
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
      let texture: THREE.Texture
      try { texture = await new THREE.TextureLoader().loadAsync(url) } finally { URL.revokeObjectURL(url) }
      const decoded = texture.image as HTMLImageElement
      if (decoded.width !== 2048 || decoded.height !== 1024) throw new Error('同源树冠图集尺寸不匹配')
      texture.colorSpace = THREE.SRGBColorSpace
      // Generate filtered mip colors together with coverage. Transparent
      // pixels must not be interpreted as opaque black canopy albedo.
      texture.premultiplyAlpha = true
      texture.minFilter = THREE.LinearMipmapLinearFilter; texture.anisotropy = 1
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
      texture.needsUpdate = true
      return texture
    }))
    if (this.disposed) { textures.forEach(texture => texture.dispose()); return }
    this.uniforms.geoTreeAsh.value.dispose(); this.uniforms.geoTreeAsh.value = textures[0]
    this.uniforms.geoTreeOak.value.dispose(); this.uniforms.geoTreeOak.value = textures[1]
    this.stats.bytes = manifest.atlases.reduce((sum, atlas) => sum + atlas.image.bytes, 0)
    this.stats.ready = true
  }
  dispose() {
    this.disposed = true; this.uniforms.geoTreeAsh.value.dispose(); this.uniforms.geoTreeOak.value.dispose()
  }
}

export const treeImpostorShader = `
uniform sampler2D geoTreeAsh;
uniform sampler2D geoTreeOak;
vec4 geographicTreeFrame(float frame, vec2 localUv, vec2 gradX, vec2 gradY, float species) {
  vec2 origin = vec2(mod(frame, 4.0) * 0.25, (1.0 - floor(frame / 4.0)) * 0.5);
  vec2 uv = origin + localUv * vec2(0.25, 0.5);
  if (species < 1.5) return textureGrad(geoTreeAsh, uv, gradX * vec2(0.25, 0.5), gradY * vec2(0.25, 0.5));
  return textureGrad(geoTreeOak, uv, gradX * vec2(0.25, 0.5), gradY * vec2(0.25, 0.5));
}
vec4 geographicTreeCanopy(vec2 localUv, float angle, float species, out float mip) {
  vec2 gradX = dFdx(localUv), gradY = dFdy(localUv);
  float footprint = max(max(length(gradX), length(gradY)) * 512.0, 1.0);
  mip = clamp(log2(footprint), 0.0, 8.0);
  float limit = min(1.0, 256.0 / footprint);
  gradX *= limit; gradY *= limit;
  // Whole power-of-two cells stay separate during mip reduction. Clamp each
  // frame's bilinear footprint to its own selected mip's texel centers.
  float inset = 0.5 * exp2(ceil(mip)) / 512.0;
  localUv = clamp(localUv, vec2(inset), vec2(1.0 - inset));
  float view = mod(angle / 0.78539816339, 8.0);
  float frame = floor(view);
  vec4 a = geographicTreeFrame(frame, localUv, gradX, gradY, species);
  vec4 b = geographicTreeFrame(mod(frame + 1.0, 8.0), localUv, gradX, gradY, species);
  // Upload/mip filtering already stores premultiplied samples. Multiplying
  // alpha here again would darken every minified crown. Blend first, then
  // recover straight color for the material's separate coverage test.
  // The sixteen underlying source frame files remain unchanged.
  vec4 result = mix(a, b, fract(view));
  result.rgb /= max(result.a, 0.0001);
  return result;
}`
