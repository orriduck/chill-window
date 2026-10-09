import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { treeNearTex, treeNearBTex } from '../textures'

export interface ForestPlacement { x: number; y: number; z: number; height: number; yaw: number; variant: number }

/** Existing textured tree silhouettes replace untextured polygon crowns.
 * The forest boundary is OSM data; individual trees remain visual samples,
 * not a surveyed tree inventory or a claim about local species. */
export class GeoForest {
  private focus = new THREE.Vector2()
  private geometry: THREE.BufferGeometry
  private materials = [treeNearTex, treeNearBTex].map(map => new THREE.MeshLambertMaterial({
    map, alphaTest: 0.42, side: THREE.DoubleSide,
  }))
  constructor(mode: 'near' | 'far' = 'near') {
    const plane = new THREE.PlaneGeometry(0.74, 1)
    plane.translate(0, 0.5, 0)
    const second = plane.clone().rotateY(Math.PI / 2)
    this.geometry = mergeGeometries([plane, second], false)!
    plane.dispose(); second.dispose()
    for (const material of this.materials) {
      material.onBeforeCompile = shader => {
        shader.uniforms.geoForestFocus = { value: this.focus }
        // Both inspected atlases are 512x256. Keep linear filtering inside
        // each cell so a neighbouring crown cannot bleed into its border.
        shader.uniforms.geoTreeAtlasInset = { value: new THREE.Vector2(0.5 / 512, 0.5 / 256) }
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 treeAtlasCell;\nuniform vec2 geoTreeAtlasInset;\nuniform vec2 geoForestFocus;\nvarying float geoTreeDistance;')
          .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vMapUv * (vec2(0.25, 0.5) - 2.0 * geoTreeAtlasInset) + treeAtlasCell + geoTreeAtlasInset;\n#endif')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\ngeoTreeDistance = length((instanceMatrix * vec4(position, 1.0)).xz - geoForestFocus);')
        const fade = mode === 'near' ? '1.0 - smoothstep(500.0, 650.0, geoTreeDistance)' : 'smoothstep(500.0, 650.0, geoTreeDistance) * (1.0 - smoothstep(3000.0, 4500.0, geoTreeDistance))'
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float geoTreeDistance;')
          .replace('#include <alphatest_fragment>', `diffuseColor.a *= ${fade};\n#include <alphatest_fragment>`)
      }
      material.customProgramCacheKey = () => `geographic-forest-atlas-inset-v3-${mode}`
    }
  }
  setFocus(x: number, z: number) { this.focus.set(x, z) }
  addInstances(parent: THREE.Group, placements: ForestPlacement[]) {
    const transform = new THREE.Object3D()
    for (let atlas = 0; atlas < 2; atlas++) {
      const batch = placements.filter(p => Math.floor(p.variant / 8) === atlas)
      if (!batch.length) continue
      const geometry = this.geometry.clone(), cells = new Float32Array(batch.length * 2)
      const mesh = new THREE.InstancedMesh(geometry, this.materials[atlas], batch.length)
      mesh.name = 'osm-forest-textured-trees'
      mesh.userData.individualTreeLocationsEstimated = true
      for (let index = 0; index < batch.length; index++) {
        const p = batch[index]
        const variant = p.variant % 8
        cells[index * 2] = (variant % 4) / 4; cells[index * 2 + 1] = 1 - (Math.floor(variant / 4) + 1) / 2
        transform.position.set(p.x, p.y, p.z); transform.rotation.set(0, p.yaw, 0)
        transform.scale.setScalar(p.height); transform.updateMatrix(); mesh.setMatrixAt(index, transform.matrix)
      }
      geometry.setAttribute('treeAtlasCell', new THREE.InstancedBufferAttribute(cells, 2))
      mesh.computeBoundingSphere(); parent.add(mesh)
    }
  }
  dispose() { this.geometry.dispose(); this.materials.forEach(m => m.dispose()) }
}
