import * as THREE from 'three'

/** Apply the local track UV cadence without altering terrain's shared sampler. */
export function configureBallastTexture(texture: THREE.Texture): void {
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(3, 90)
  texture.anisotropy = 8
}
