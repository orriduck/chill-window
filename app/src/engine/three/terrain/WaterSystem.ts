import * as THREE from 'three'
import { MAX_WATER_HALF_WIDTH, riverWaterElevationAt, waterChannelAt } from './TerrainGen'

const RIBBON_LENGTH = 700 // water follows the camera over this Z window
const RIBBON_BEHIND = 140 // how far behind the camera the ribbon extends
const SEGMENTS = 140 // lengthwise segments (~5 units each)
const RIBBON_WIDTH = MAX_WATER_HALF_WIDTH * 2 + 3
const RIPPLE_REPEAT_Y = 14
const RIPPLE_FLOW_SPEED = 0.014

/** Preserve world-relative water detail while letting it drift downstream. */
export function waterRippleOffset(time: number, camZ: number): number {
  return THREE.MathUtils.euclideanModulo(
    (camZ / RIBBON_LENGTH) * RIPPLE_REPEAT_Y - time * RIPPLE_FLOW_SPEED,
    1,
  )
}

function createRippleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const context = canvas.getContext('2d')!
  const base = context.createLinearGradient(0, 0, 0, canvas.height)
  base.addColorStop(0, '#3f7188')
  base.addColorStop(0.5, '#5f94aa')
  base.addColorStop(1, '#356b82')
  context.fillStyle = base
  context.fillRect(0, 0, canvas.width, canvas.height)

  context.lineCap = 'round'
  for (let i = 0; i < 96; i++) {
    const y = (i * 47 + 19) % canvas.height
    const x = (i * 71 + 13) % canvas.width
    const length = 12 + ((i * 29) % 46)
    const brightness = 168 + ((i * 17) % 54)
    const alpha = 0.09 + ((i * 11) % 13) / 100
    context.strokeStyle = `rgba(${brightness}, ${brightness + 16}, ${brightness + 20}, ${alpha})`
    context.lineWidth = i % 5 === 0 ? 2 : 1
    context.beginPath()
    context.moveTo(x, y)
    context.lineTo(Math.min(canvas.width + 8, x + length), y + (i % 3) - 1)
    context.stroke()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(1.8, RIPPLE_REPEAT_Y)
  texture.anisotropy = 4
  return texture
}

/** Slow-moving river water: a ribbon mesh that tracks the meandering
 *  channel centreline. Vertices are rebuilt in world space each update
 *  (cheap: ~300 verts) and gently bob for a lazy ripple. */
export class WaterSystem {
  readonly mesh: THREE.Mesh
  private geometry: THREE.PlaneGeometry
  private material: THREE.MeshStandardMaterial
  private rippleTexture: THREE.CanvasTexture
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

    this.rippleTexture = createRippleTexture()
    this.material = new THREE.MeshStandardMaterial({
      // A restrained blue-green base keeps the surface legible at the
      // shallow side-window angle even without a reflection environment.
      color: 0x78a6b8,
      map: this.rippleTexture,
      emissive: 0x102832,
      emissiveIntensity: 0.22,
      transparent: true,
      opacity: 0,
      roughness: 0.16,
      metalness: 0.18,
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
    this.material.opacity = 0.92 * fade
    this.rippleTexture.offset.y = waterRippleOffset(time, camZ)

    const pos = this.geometry.attributes.position.array as Float32Array
    const zStart = camZ - RIBBON_BEHIND
    for (let v = 0; v < this.localX.length; v++) {
      const localX = this.localX[v]
      const worldZ = zStart + this.rowT[v] * RIBBON_LENGTH
      const channel = waterChannelAt(worldZ)
      pos[v * 3] = channel.centerX + localX * (channel.halfWidth / (RIBBON_WIDTH / 2))
      const waterY = riverWaterElevationAt(worldZ, strength)
      pos[v * 3 + 1] = waterY + Math.sin(time * 1.2 + worldZ * 0.35 + localX * 0.6) * 0.05
      pos[v * 3 + 2] = worldZ
    }
    this.geometry.attributes.position.needsUpdate = true
    this.geometry.computeVertexNormals()
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
    this.rippleTexture.dispose()
  }
}
