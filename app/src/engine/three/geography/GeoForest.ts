import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { treeNearTex, treeNearBTex } from '../textures'
import { detailCoverageDeclarations, detailCoverageLookup, type GeoDetailCoverage } from './GeoDetailCoverage'
import { treeScreenThreshold } from './GeoCloseTrees'
import { treeImpostorShader, type GeoTreeImpostors } from './GeoTreeImpostors'

export interface ForestPlacement { x: number; y: number; z: number; height: number; yaw: number; variant: number; close3D?: boolean | number; broadleaf?: boolean }

/** Existing textured tree silhouettes replace untextured polygon crowns.
 * The forest boundary is OSM data; individual trees remain visual samples,
 * not a surveyed tree inventory or a claim about local species. */
export class GeoForest {
  private focus = new THREE.Vector2()
  private closeEnabled = { value: 0 }
  private impostorsEnabled = { value: 1 }
  private geometry: THREE.BufferGeometry
  private materials = [treeNearTex, treeNearBTex].map(map => new THREE.MeshLambertMaterial({
    map, alphaTest: 0.42, side: THREE.DoubleSide,
  }))
  constructor(mode: 'near' | 'far' = 'near', coverage?: GeoDetailCoverage, impostors?: GeoTreeImpostors) {
    const plane = new THREE.PlaneGeometry(0.74, 1)
    plane.translate(0, 0.5, 0)
    const second = plane.clone().rotateY(Math.PI / 2)
    this.geometry = mergeGeometries([plane, second], false)!
    plane.dispose(); second.dispose()
    this.geometry.setAttribute('treePlane', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 1, 1, 1], 1))
    // Camera-facing 22m source frames extend beyond the old narrow cards.
    // Keep bounds conservative for every camera direction and both modes.
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.525, 0), 0.8)
    if (!impostors) this.impostorsEnabled.value = 0
    for (const material of this.materials) {
      material.onBeforeCompile = shader => {
        shader.uniforms.geoForestFocus = { value: this.focus }
        shader.uniforms.geoCloseEnabled = this.closeEnabled
        shader.uniforms.geoTreeImpostorsEnabled = this.impostorsEnabled
        if (impostors) Object.assign(shader.uniforms, impostors.uniforms)
        if (coverage) {
          shader.uniforms.geoDetailCoverage = { value: coverage.texture }
          shader.uniforms.geoDetailMinTile = { value: coverage.minTile }
        }
        // Both inspected atlases are 512x256. Keep linear filtering inside
        // each cell so a neighbouring crown cannot bleed into its border.
        shader.uniforms.geoTreeAtlasInset = { value: new THREE.Vector2(0.5 / 512, 0.5 / 256) }
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 treeAtlasCell;\nuniform vec2 geoTreeAtlasInset;\nuniform vec2 geoForestFocus;\nvarying float geoTreeDistance;')
          .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vMapUv * (vec2(0.25, 0.5) - 2.0 * geoTreeAtlasInset) + treeAtlasCell + geoTreeAtlasInset;\n#endif')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\ngeoTreeCenter = instanceMatrix[3].xz;\ngeoTreeDistance = length(geoTreeCenter - geoForestFocus);')
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float treeCloseModel;\nvarying float geoTreeCloseModel;\nvarying vec2 geoTreeCenter;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\ngeoTreeCloseModel = treeCloseModel;')
        if (impostors) {
          shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute float treeYaw;
attribute float treeSpecies;
attribute float treePlane;
uniform float geoTreeImpostorsEnabled;
varying vec2 geoTreePhotoUv;
varying float geoTreeViewAngle;
varying float geoTreeSpecies;
varying float geoTreePlane;`)
            .replace('#include <beginnormal_vertex>', `
vec2 geoTreeCameraDelta = geoForestFocus - instanceMatrix[3].xz;
float geoBillboardAngle = atan(geoTreeCameraDelta.x, geoTreeCameraDelta.y) - treeYaw;
#include <beginnormal_vertex>
if (geoTreeImpostorsEnabled > 0.5 && treeSpecies > 0.5) objectNormal = vec3(sin(geoBillboardAngle), 0.0, cos(geoBillboardAngle));`)
            .replace('#include <uv_vertex>', '#include <uv_vertex>\ngeoTreePhotoUv = uv;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
geoTreeViewAngle = -atan(geoTreeCameraDelta.y, geoTreeCameraDelta.x) - treeYaw;
geoTreeSpecies = treeSpecies; geoTreePlane = treePlane;
if (geoTreeImpostorsEnabled > 0.5 && treeSpecies > 0.5) {
  float width = position.x * (1.1 / 0.74);
  transformed = vec3(width * cos(geoBillboardAngle), position.y * 1.1 - 0.025, -width * sin(geoBillboardAngle));
  if (treePlane > 0.5) transformed = vec3(0.0);
}`)
          shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform float geoTreeImpostorsEnabled;
varying vec2 geoTreePhotoUv;
varying float geoTreeViewAngle;
varying float geoTreeSpecies;
varying float geoTreePlane;
${treeImpostorShader}`)
            .replace('#include <map_fragment>', `
float geoTreePhotoMip = 0.0;
if (geoTreeImpostorsEnabled > 0.5 && geoTreeSpecies > 0.5) {
  if (geoTreePlane > 0.5) discard;
  diffuseColor *= geographicTreeCanopy(geoTreePhotoUv, geoTreeViewAngle, geoTreeSpecies, geoTreePhotoMip);
} else {
  #include <map_fragment>
}`)
        }
        const fade = mode === 'near' ? 'geoDetailReady * (1.0 - smoothstep(500.0, 650.0, geoTreeDistance))' : 'mix(1.0, smoothstep(500.0, 650.0, geoTreeDistance), geoDetailReady) * (1.0 - smoothstep(3000.0, 4500.0, geoTreeDistance))'
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nuniform float geoCloseEnabled;\nvarying float geoTreeCloseModel;\nvarying float geoTreeDistance;\nvarying vec2 geoTreeCenter;\n${coverage ? detailCoverageDeclarations : ''}`)
          .replace('#include <alphatest_fragment>', `${coverage ? detailCoverageLookup('geoTreeCenter') : 'float geoDetailReady = 1.0;'}
${impostors ? `if (geoTreeImpostorsEnabled > 0.5 && geoTreeSpecies > 0.5) {
  if (${treeScreenThreshold} >= (${fade})) discard;
  if (diffuseColor.a < mix(0.42, 0.08, smoothstep(2.0, 7.0, geoTreePhotoMip))) discard;
} else {` : ''}
diffuseColor.a *= (${fade});
#include <alphatest_fragment>
${impostors ? '}' : ''}
if (geoCloseEnabled > 0.5 && geoTreeCloseModel > 0.5 && ${treeScreenThreshold} < 1.0 - smoothstep(geoTreeCloseModel - 35.0, geoTreeCloseModel, geoTreeDistance)) discard;`)
      }
      material.customProgramCacheKey = () => `geographic-forest-coverage-v7-${mode}-${!!coverage}-${!!impostors}`
    }
  }
  setFocus(x: number, z: number) { this.focus.set(x, z) }
  setCloseTreesEnabled(enabled: boolean) { this.closeEnabled.value = enabled ? 1 : 0 }
  setImpostorsEnabled(enabled: boolean) { this.impostorsEnabled.value = enabled ? 1 : 0 }
  addInstances(parent: THREE.Group, placements: ForestPlacement[]) {
    const transform = new THREE.Object3D()
    for (let atlas = 0; atlas < 2; atlas++) {
      const batch = placements.filter(p => Math.floor(p.variant / 8) === atlas)
      if (!batch.length) continue
      const geometry = this.geometry.clone(), cells = new Float32Array(batch.length * 2), close = new Float32Array(batch.length)
      const yaw = new Float32Array(batch.length), species = new Float32Array(batch.length)
      const mesh = new THREE.InstancedMesh(geometry, this.materials[atlas], batch.length)
      mesh.name = 'osm-forest-textured-trees'
      mesh.userData.individualTreeLocationsEstimated = true
      for (let index = 0; index < batch.length; index++) {
        const p = batch[index]
        close[index] = typeof p.close3D === 'number' ? p.close3D : p.close3D ? 115 : 0
        yaw[index] = p.yaw; species[index] = p.broadleaf ? (p.variant % 2 === 0 ? 1 : 2) : 0
        const variant = p.variant % 8
        cells[index * 2] = (variant % 4) / 4; cells[index * 2 + 1] = 1 - (Math.floor(variant / 4) + 1) / 2
        transform.position.set(p.x, p.y, p.z); transform.rotation.set(0, p.yaw, 0)
        transform.scale.setScalar(p.height); transform.updateMatrix(); mesh.setMatrixAt(index, transform.matrix)
      }
      geometry.setAttribute('treeAtlasCell', new THREE.InstancedBufferAttribute(cells, 2))
      geometry.setAttribute('treeCloseModel', new THREE.InstancedBufferAttribute(close, 1))
      geometry.setAttribute('treeYaw', new THREE.InstancedBufferAttribute(yaw, 1))
      geometry.setAttribute('treeSpecies', new THREE.InstancedBufferAttribute(species, 1))
      mesh.computeBoundingSphere(); parent.add(mesh)
    }
  }
  dispose() { this.geometry.dispose(); this.materials.forEach(m => m.dispose()) }
}
