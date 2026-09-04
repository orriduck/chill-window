import * as THREE from 'three'
import { trackElevationAt } from './RouteProfile'

/** Low-frequency world-anchored silhouettes. Five recycled strips per layer
 * avoid a camera-locked backdrop; far hills move more slowly than the fields. */
export class DistantHills {
  readonly group = new THREE.Group()
  private strips: { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>; layer: number; slot: number; segment: number }[] = []
  private colors = [new THREE.Color(0x3d6559), new THREE.Color(0x668685), new THREE.Color(0x8ba2a3)]
  constructor() {
    for (let layer = 2; layer >= 0; layer--) for (let slot = 0; slot < 5; slot++) {
      const material = new THREE.MeshStandardMaterial({ color: this.colors[layer], side: THREE.DoubleSide, fog: false, roughness: 1 })
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material)
      mesh.name = `distant-hills-${layer}-${slot}`
      this.strips.push({ mesh, layer, slot, segment: Infinity })
      this.group.add(mesh)
    }
  }
  update(z: number, fog: THREE.Color, daylight: number, shelter: number) {
    this.group.visible = shelter < 0.9
    const start = Math.floor(z / 640) - 2
    for (const strip of this.strips) {
      const segment = start + ((strip.slot - start % 5 + 5) % 5)
      if (strip.segment !== segment) {
        strip.segment = segment
        strip.mesh.geometry.dispose()
        const vertices: number[] = []
        const indices: number[] = []
        const { layer } = strip
        const across = 16
        for (let i = 0; i <= 40; i++) {
          const wz = segment * 640 + i * 16
          const phase = wz * 0.007 + layer * 2.8
          const ridge = 66 + layer * 39 + Math.sin(phase) * 31 + Math.sin(phase * 2.3 + 1.7) * 16 + Math.sin(phase * 5.1) * 4
          for (let j = 0; j <= across; j++) {
            const u = j / across
            const x = 380 + layer * 245 + u * 290
            const shoulder = Math.pow(Math.sin(u * Math.PI), 1.3)
            const ribs = Math.sin(phase * 4.3 + u * 9) * Math.sin(u * Math.PI) * 5
            vertices.push(x, -12 + (ridge + ribs) * shoulder + trackElevationAt(wz), wz)
            if (i < 40 && j < across) {
              const n = i * (across + 1) + j
              indices.push(n, n + across + 1, n + 1, n + 1, n + across + 1, n + across + 2)
            }
          }
        }
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
        geometry.setIndex(indices)
        geometry.computeVertexNormals()
        geometry.computeBoundingSphere()
        strip.mesh.geometry = geometry
      }
      strip.mesh.material.color.copy(this.colors[strip.layer]).multiplyScalar(THREE.MathUtils.clamp(daylight * 2.6, 0.65, 1.25)).lerp(fog, 0.08 + strip.layer * 0.15 + shelter * 0.3)
    }
  }
  dispose() {
    for (const { mesh } of this.strips) { mesh.geometry.dispose(); mesh.material.dispose() }
    this.group.clear()
  }
}
