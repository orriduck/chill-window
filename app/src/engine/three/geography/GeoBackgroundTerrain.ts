import * as THREE from 'three'
import { GeoDetailCoverage, detailCoverageDeclarations, detailCoverageLookup } from './GeoDetailCoverage'

/** The full DEM is fallback terrain. Replace only fragments whose matching
 * detailed tile is GPU ready in the current view; keep all other hills intact. */
export function createBackgroundTerrainMaterial(ground: THREE.MeshStandardMaterial, coverage: GeoDetailCoverage) {
  const material = ground.clone()
  // Material.clone() copies physical settings, but not shader callbacks. Keep
  // the composed land/water mask + source imagery hooks explicitly.
  const previous = ground.onBeforeCompile, key = ground.customProgramCacheKey()
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    shader.uniforms.geoDetailCoverage = { value: coverage.texture }
    shader.uniforms.geoDetailMinTile = { value: coverage.minTile }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 geoBackgroundPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ngeoBackgroundPosition = position.xz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 geoBackgroundPosition;\n${detailCoverageDeclarations}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${detailCoverageLookup('geoBackgroundPosition')}\nif (geoDetailReady > 0.5) discard;`)
  }
  material.customProgramCacheKey = () => `${key}-background-ready-coverage-v1`
  return material
}
