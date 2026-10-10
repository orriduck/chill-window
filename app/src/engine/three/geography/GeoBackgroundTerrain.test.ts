import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createBackgroundTerrainMaterial } from './GeoBackgroundTerrain'
import { GeoDetailCoverage } from './GeoDetailCoverage'
import { GeoAerial } from './GeoAerial'

describe('background DEM replacement', () => {
  it('keeps land/water and actual aerial hooks on its own material, without changing near terrain', () => {
    const ground = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), vertexColors: true, roughness: 0.95 })
    const mask = { value: new THREE.Texture() }
    ground.onBeforeCompile = shader => {
      shader.uniforms.geoLandMask = mask
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', 'if (texture2D(geoLandMask, vec2(0.0)).r > 0.5) discard;')
    }
    ground.customProgramCacheKey = () => 'source-land-water'
    // Exercise the real aerial installer without fetching its source assets.
    GeoAerial.prototype.install.call({ installed: new Set(), uniforms: { geoAerialEnabled: { value: 1 } }, corridor: { uniforms: {} } } as unknown as GeoAerial, ground)
    const nearHook = ground.onBeforeCompile, nearKey = ground.customProgramCacheKey()
    const coverage = new GeoDetailCoverage(), background = createBackgroundTerrainMaterial(ground, coverage)
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader } as THREE.WebGLProgramParametersWithUniforms
    background.onBeforeCompile(shader, {} as THREE.WebGLRenderer)
    expect(background).not.toBe(ground)
    expect(background.map).toBe(ground.map)
    expect(background.roughness).toBe(0.95)
    expect(shader.uniforms.geoLandMask).toBe(mask)
    expect(shader.fragmentShader).toContain('texture2D(geoLandMask')
    expect(shader.fragmentShader).toContain('geographicCorridorSample(geoAerialPosition.xz)')
    expect(shader.fragmentShader).toContain('if (geoDetailReady > 0.5) discard;')
    expect(shader.vertexShader).toContain('geoBackgroundPosition = position.xz;')
    expect(shader.uniforms.geoDetailCoverage.value).toBe(coverage.texture)
    expect(shader.uniforms.geoDetailMinTile.value).toBe(coverage.minTile)
    coverage.update(-0.01, 256, key => key === '-1,1')
    expect(shader.uniforms.geoDetailMinTile.value.toArray()).toEqual([-4, -2])
    expect(ground.onBeforeCompile).toBe(nearHook)
    expect(ground.customProgramCacheKey()).toBe(nearKey)
    expect(background.customProgramCacheKey()).not.toBe(nearKey)
    background.dispose(); ground.dispose(); ground.map?.dispose(); mask.value.dispose(); coverage.dispose()
  })

  it('marks only uploaded current-view tiles and restores fallback after the view moves or readiness is lost', () => {
    const coverage = new GeoDetailCoverage()
    const ready = new Set(['0,0', '3,3', '4,0'])
    coverage.update(0, 0, key => ready.has(key))
    const count = () => Array.from(coverage.pixels).filter((v, i) => i % 4 === 0 && v === 255).length
    expect(count()).toBe(2) // cached tile 4,0 is outside the drawn 7x7 footprint
    expect(coverage.pixels[(3 * 7 + 3) * 4]).toBe(255)
    expect(coverage.pixels[(3 * 7 + 4) * 4]).toBe(0) // CPU-created is insufficient
    ready.delete('0,0')
    coverage.update(0, 0, key => ready.has(key))
    expect(coverage.pixels[(3 * 7 + 3) * 4]).toBe(0)
    coverage.update(2048, 2048, key => ready.has(key))
    expect(coverage.minTile.toArray()).toEqual([5, 5])
    expect(count()).toBe(0)
    coverage.dispose()
  })
})
