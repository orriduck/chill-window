import * as THREE from 'three'

export type GroundSurfaceMode = 'current' | 'leafLitter'
export function groundSurfaceMode(value: string | null): GroundSurfaceMode {
  if (!value || value === 'current') return 'current'
  if (value === 'leafLitter') return value
  throw new Error(`Unknown groundSurface: ${value}`)
}
const ROOT = '/geodata/hudson/materials/forest-floor/'
const MANIFEST_SHA = '3dcb220b70e3046db414433e684d08e137e929be3783f19a10d5a0f70d080c15'
const MAPS = [
  { kind: 'Diffuse', filename: 'leaves_forest_ground_diff_1k.jpg', bytes: 1135712, sha256: 'e4aa2be8f80192378bc8aca363fc01b1f01639ebea5a87a3973c549861a01b7a' },
  { kind: 'Rough', filename: 'leaves_forest_ground_rough_1k.jpg', bytes: 514888, sha256: 'e035404a2e16ac23782145b4aa29fb1b923569b2bbb8f6c6c01e194ade37f505' },
  { kind: 'Displacement', filename: 'leaves_forest_ground_disp_1k.jpg', bytes: 544067, sha256: '305aded33a25e27b9c27e79cc8a25fe8447e9c6e604e07550698b4b29c8083f0' },
] as const
const digest = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('')
const placeholder = () => {
  const texture = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1)
  texture.needsUpdate = true
  return texture as THREE.Texture
}

/** Generic photographed material, not a Hudson survey. Its three verified
 * maps load in both comparison states and participate in the shared ground
 * material's actual GPU warmup. Never changes vertices or geographic masks. */
export class GeoForestFloor {
  readonly ready: Promise<void>
  readonly stats = { ready: false, mode: 'current' as GroundSurfaceMode, manifestSha: '', maps: [] as Array<{ filename: string; bytes: number; sha256: string; width: number; height: number }> }
  readonly uniforms = {
    geoFloorColor: { value: placeholder() }, geoFloorRough: { value: placeholder() }, geoFloorHeight: { value: placeholder() },
    geoFloorEnabled: { value: 0 },
  }
  private abort = new AbortController()
  private disposed = false
  private installed = new WeakSet<THREE.Material>()
  constructor(mode: GroundSurfaceMode) {
    this.stats.mode = mode
    this.ready = this.prepare().then(() => {
      if (this.disposed) return
      this.stats.ready = true
      this.uniforms.geoFloorEnabled.value = mode === 'leafLitter' ? 1 : 0
    }).catch(error => { this.abort.abort(); this.releaseTextures(); throw error })
  }
  private async fetchBytes(filename: string) {
    const response = await fetch(`${ROOT}${filename}`, { signal: this.abort.signal })
    if (!response.ok) throw new Error(`森林地表材质下载失败 ${filename} ${response.status}`)
    return response.arrayBuffer()
  }
  private async prepare() {
    const manifest = await this.fetchBytes('provenance.json')
    if (await digest(manifest) !== MANIFEST_SHA) throw new Error('森林地表材质来源记录校验失败')
    this.stats.manifestSha = MANIFEST_SHA
    const slots = [this.uniforms.geoFloorColor, this.uniforms.geoFloorRough, this.uniforms.geoFloorHeight]
    for (const [index, source] of MAPS.entries()) {
      const bytes = await this.fetchBytes(source.filename)
      if (bytes.byteLength !== source.bytes || await digest(bytes) !== source.sha256) throw new Error(`森林地表材质图像校验失败 ${source.filename}`)
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))
      let texture: THREE.Texture
      try { texture = await new THREE.TextureLoader().loadAsync(url) } finally { URL.revokeObjectURL(url) }
      if (this.disposed || this.abort.signal.aborted) { texture.dispose(); return }
      const image = texture.image as HTMLImageElement
      if (image.width !== 1024 || image.height !== 1024) { texture.dispose(); throw new Error(`森林地表材质尺寸不匹配 ${source.filename}`) }
      // SRGB8_ALPHA8 upload decodes the original color exactly once; scalar
      // maps remain linear data. No retint, green multiply or normal repair.
      texture.colorSpace = index === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping
      texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter
      texture.magFilter = THREE.LinearFilter; texture.anisotropy = 4; texture.needsUpdate = true
      slots[index].value.dispose(); slots[index].value = texture
      this.stats.maps.push({ filename: source.filename, bytes: bytes.byteLength, sha256: source.sha256, width: image.width, height: image.height })
    }
  }
  /** Compose AFTER aerial color replacement. The copied background hook
   * inherits this composition; roofs/buildings/water never receive it. */
  install(material: THREE.MeshStandardMaterial) {
    if (this.installed.has(material)) return
    this.installed.add(material)
    const previous = material.onBeforeCompile, key = material.customProgramCacheKey()
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer)
      Object.assign(shader.uniforms, this.uniforms)
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D geoFloorColor;
uniform sampler2D geoFloorRough;
uniform sampler2D geoFloorHeight;
uniform float geoFloorEnabled;
vec4 forestFloorSample(sampler2D sourceMap, vec3 p, vec3 weights) {
  return texture2D(sourceMap, p.zy / 1.3) * weights.x
    + texture2D(sourceMap, p.xz / 1.3) * weights.y
    + texture2D(sourceMap, p.xy / 1.3) * weights.z;
}
// Three r185 bumpmap_pars_fragment / Mikkelsen surface-gradient formula.
// Derivatives are evaluated unconditionally, outside mask/fade branches.
vec3 forestFloorNormal(vec3 surfPos, vec3 surfNormal, vec2 heightGradient, float facing) {
  vec3 sigmaX = normalize(dFdx(surfPos));
  vec3 sigmaY = normalize(dFdy(surfPos));
  vec3 r1 = cross(sigmaY, surfNormal), r2 = cross(surfNormal, sigmaX);
  float determinant = dot(sigmaX, r1) * facing;
  vec3 gradient = sign(determinant) * (heightGradient.x * r1 + heightGradient.y * r2);
  vec3 bumped = abs(determinant) * surfNormal - gradient;
  return dot(bumped, bumped) > 1e-12 ? normalize(bumped) : surfNormal;
}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
vec3 floorWeights = pow(abs(normalize(geoNormal)), vec3(4.0));
floorWeights /= max(dot(floorWeights, vec3(1.0)), 0.001);
vec4 floorLand = texture2D(geoLandMask, (geoPosition.xz - geoBounds.xy) / (geoBounds.zw - geoBounds.xy));
// 12..45m is an artist visibility fade; neither limit is measured geography.
float floorCover = geoFloorEnabled * (1.0 - smoothstep(12.0, 45.0, length(vViewPosition)))
  * smoothstep(0.2, 0.8, floorLand.g) * (1.0 - step(0.5, floorLand.r))
  * (1.0 - step(0.5, geoLandSourceMode));
vec3 floorColor = forestFloorSample(geoFloorColor, geoPosition, floorWeights).rgb;
float floorRoughness = forestFloorSample(geoFloorRough, geoPosition, floorWeights).r;
float floorHeight = forestFloorSample(geoFloorHeight, geoPosition, floorWeights).r;
// Small artist shading amplitude only; the source height never displaces DEM.
vec2 floorHeightGradient = vec2(dFdx(floorHeight), dFdy(floorHeight)) * 0.006;
diffuseColor.rgb = mix(diffuseColor.rgb, floorColor, floorCover);
roughnessFactor = mix(roughnessFactor, floorRoughness, floorCover);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
vec3 floorBumpedNormal = forestFloorNormal(-vViewPosition, normal, floorHeightGradient, faceDirection);
// Keep the disabled baseline exact; faded PBR normals must remain unit length.
vec3 floorMixedNormal = mix(normal, floorBumpedNormal, floorCover);
normal = floorCover > 0.0 && dot(floorMixedNormal, floorMixedNormal) > 1e-12 ? normalize(floorMixedNormal) : normal;`)
    }
    material.customProgramCacheKey = () => `${key}-generic-ph-forest-floor-v1`
    material.needsUpdate = true
  }
  private releaseTextures() { for (const uniform of [this.uniforms.geoFloorColor, this.uniforms.geoFloorRough, this.uniforms.geoFloorHeight]) uniform.value.dispose() }
  dispose() { this.disposed = true; this.abort.abort(); this.releaseTextures() }
}
