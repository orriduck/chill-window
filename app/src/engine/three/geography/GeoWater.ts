import * as THREE from 'three'

/** Two-scale normal motion only. Source polygons, heights and holes stay intact. */
export class GeographicWater {
  private phase = { value: 0 }
  readonly river = this.material(0x377d89)
  readonly pond = this.material(0x4b8c82)

  private material(color: number) {
    const material = new THREE.MeshStandardMaterial({ color, roughness: .32, metalness: .18, side: THREE.DoubleSide })
    material.onBeforeCompile = shader => {
      shader.uniforms.railWaterTime = this.phase
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 railWaterPosition;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nrailWaterPosition = position.xz;')
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float railWaterTime; varying vec2 railWaterPosition;')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
float waveA = sin(dot(railWaterPosition,vec2(.13,.07)) + railWaterTime*.55);
float waveB = sin(dot(railWaterPosition,vec2(-.41,.28)) - railWaterTime*.8);
vec3 waveNormal = vec3(waveA*.035 + waveB*.017,0.,waveA*.025-waveB*.022);
normal = normalize(normal + mat3(viewMatrix)*waveNormal);
`)
    }
    material.customProgramCacheKey = () => 'geographic-water-two-scale-v1'
    return material
  }
  update(time: number) { this.phase.value = time }
  dispose() { this.river.dispose(); this.pond.dispose() }
}
