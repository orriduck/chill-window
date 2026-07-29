import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { configureBallastTexture } from './ballast'

describe('configureBallastTexture', () => {
  it('prepares the local ballast repeat without forcing an empty texture upload', () => {
    const texture = new THREE.Texture()

    configureBallastTexture(texture)

    expect(texture.wrapS).toBe(THREE.RepeatWrapping)
    expect(texture.wrapT).toBe(THREE.RepeatWrapping)
    expect(texture.repeat.toArray()).toEqual([3, 90])
    expect(texture.anisotropy).toBe(8)
    expect(texture.version).toBe(0)
  })
})
