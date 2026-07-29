import * as THREE from 'three'
import { riverCenterX, RIVER_HALF_WIDTH, WATER_LEVEL } from './TerrainGen'
import { trackElevationAt } from './RouteProfile'

const RIBBON_LENGTH = 700 // water follows the camera over this Z window
const RIBBON_BEHIND = 140 // how far behind the camera the ribbon extends
const SEGMENTS = 140 // lengthwise segments (~5 units each)
const RIBBON_WIDTH = RIVER_HALF_WIDTH * 2 + 3

/** Slow-moving river water: a ribbon mesh that tracks the meandering
 *  channel centreline. Vertices are rebuilt in world space each update
 *  (cheap: ~300 verts) and gently bob for a lazy ripple. */
export class WaterSystem {
  readonly mesh: THREE.Mesh
  private geometry: THREE.PlaneGeometry
  private material: THREE.MeshStandardMaterial
  private localX: Float32Array // original across-ribbon offsets
  private rowT: Float32Array // 0..1 along-ribbon parameter per vertex

  constructor() {
    this.geometry = new THREE.PlaneGeometry(RIBBON_WIDTH, RIBBON_LENGTH, 1, SEGMENTS)
    this.geometry.rotateX(-Math.PI / 2) // lie flat, length along Z

    // Capture the template offsets once — update() writes world coords into
    // the position attribute, so the local frame must be kept separately
    const base = this.geometry.attributes.position.array as Float32Array
    this.localX = new Float32Array(base.length / 3)
    this.rowT = new Float32Array(base.length / 3)
    for (let v = 0; v < this.localX.length; v++) {
      this.localX[v] = base[v * 3]
      this.rowT[v] = (base[v * 3 + 2] + RIBBON_LENGTH / 2) / RIBBON_LENGTH
    }

    this.material = new THREE.MeshStandardMaterial({
      // Light sky-mix blue: without an envmap the color itself must carry
      // the "reflects the sky" cue, especially at grazing view angles
      color: 0x6a9ab8,
      transparent: true,
      opacity: 0,
      roughness: 0.06,
      metalness: 0.55,
    })

    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false // world-space verts move far from origin
    this.mesh.visible = false
    this.mesh.receiveShadow = true
  }

  /**
   * @param camZ     camera Z position
   * @param strength river carve strength 0..1 (from the biome blend)
   * @param time     elapsed seconds for the ripple animation
   */
  update(camZ: number, strength: number, time: number) {
    // Fade with the biome blend; hide entirely when the channel is shallow
    const fade = THREE.MathUtils.clamp((strength - 0.55) / 0.35, 0, 1)
    if (fade <= 0.01) {
      this.mesh.visible = false
      return
    }
    this.mesh.visible = true
    this.material.opacity = 0.82 * fade

    const pos = this.geometry.attributes.position.array as Float32Array
    const zStart = camZ - RIBBON_BEHIND
    for (let v = 0; v < this.localX.length; v++) {
      const localX = this.localX[v]
      const worldZ = zStart + this.rowT[v] * RIBBON_LENGTH
      const cx = riverCenterX(worldZ)
      pos[v * 3] = cx + localX
      // The river is a valley companion to the railway. Following the same
      // gentle longitudinal profile keeps the water, carved bank and raised
      // rail corridor together when the route climbs or descends.
      const waterY = trackElevationAt(worldZ) - 0.75 - (Math.abs(WATER_LEVEL) - 0.75) * strength
      pos[v * 3 + 1] = waterY + Math.sin(time * 1.2 + worldZ * 0.35 + localX * 0.6) * 0.05
      pos[v * 3 + 2] = worldZ
    }
    this.geometry.attributes.position.needsUpdate = true
    this.geometry.computeVertexNormals()
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }
}
