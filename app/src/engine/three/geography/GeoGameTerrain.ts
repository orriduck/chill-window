import * as THREE from 'three'

const loader = new THREE.TextureLoader()
let grass: THREE.Texture, dirt: THREE.Texture
function paintedTexture(filename: string, sha256: string) {
  return fetch(`${import.meta.env.BASE_URL}textures/fantasy/${filename}`).then(async response => {
    if (!response.ok) throw new Error(`Painted terrain unavailable: ${filename}`)
    const bytes = await response.arrayBuffer()
    const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('')
    if (actual !== sha256) throw new Error(`Painted terrain checksum failed: ${filename}`)
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
    try {
      const texture = await loader.loadAsync(url)
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping
      texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4
      return texture
    } finally { URL.revokeObjectURL(url) }
  })
}
export const gameTerrainTexturesReady = Promise.all([
  paintedTexture('grass_34.png', '8ad5d6826e118af89fd6d262098fef3f6020e25d0db3bac065652571f660e473'),
  paintedTexture('dirt_9.png', '356c83de281a5c51c710f50ea1321757bc60399b9695cd327b614d05e89f6bae'),
]).then(([g, d]) => { grass = g; dirt = d })

/** Both DEM resolutions compose this identical world-coordinate shader with
 * the background coverage discard. Original bright source pixels contribute
 * brush strokes through luminance; all color is the authored muted palette. */
export function installGameTerrain(material: THREE.MeshStandardMaterial, landMask: THREE.Texture, bounds: number[]) {
  material.onBeforeCompile = shader => {
    shader.uniforms.gameGrass = { value: grass }; shader.uniforms.gameDirt = { value: dirt }
    shader.uniforms.gameLand = { value: landMask }; shader.uniforms.gameBounds = { value: new THREE.Vector4(...bounds) }
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 gamePosition; varying vec3 gameNormal;').replace('#include <begin_vertex>', '#include <begin_vertex>\ngamePosition = position; gameNormal = normal;')
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D gameGrass; uniform sampler2D gameDirt; uniform sampler2D gameLand; uniform vec4 gameBounds;
varying vec3 gamePosition; varying vec3 gameNormal;
float gameNoise(vec2 p) { return sin(p.x)*sin(p.y*0.83)+0.4*sin(p.x*1.73+p.y*0.59); }
`).replace('#include <map_fragment>', `
vec2 landUv = (gamePosition.xz-gameBounds.xy)/(gameBounds.zw-gameBounds.xy);
vec4 land = texture2D(gameLand,landUv);
if (land.r>0.5) discard;
vec3 n = normalize(gameNormal);
float broad = gameNoise(gamePosition.xz*0.012)*0.5+0.5;
float brush = dot(texture2D(gameGrass,gamePosition.xz*0.055).rgb,vec3(0.25,0.65,0.1));
float earth = dot(texture2D(gameDirt,gamePosition.xz*0.085).rgb,vec3(0.3,0.5,0.2));
vec3 meadow = mix(vec3(0.24,0.36,0.16),vec3(0.40,0.47,0.23),clamp(broad,0.0,1.0));
vec3 woodland = mix(vec3(0.18,0.29,0.16),vec3(0.30,0.37,0.19),clamp(broad,0.0,1.0));
vec3 green = mix(meadow,woodland,land.g);
green *= 0.80+brush*0.48;
float patches = smoothstep(0.70,1.1,gameNoise(gamePosition.xz*0.029))*mix(0.20,0.58,land.g);
vec3 soil = vec3(0.31,0.25,0.17)*(0.83+earth*0.48);
vec3 ground = mix(green,soil,patches);
vec3 rock = mix(vec3(0.27,0.31,0.32),vec3(0.37,0.34,0.28),clamp(broad,0.0,1.0))*(0.84+earth*0.42);
diffuseColor.rgb *= mix(ground,rock,smoothstep(0.15,0.52,1.0-abs(n.y)));
`)
  }
  material.customProgramCacheKey = () => 'hudson-painted-fantasy-terrain-v1'
}
