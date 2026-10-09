import * as THREE from 'three'
import { FIELD_LANES } from './FieldLayout'
import { hash01 } from '../core/procedural'
import { treeNearTex, applyAtlasUV } from '../textures'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** Recycled, world-anchored mulberry dykes and small farm compounds.
 * Inspired by FAO's Huzhou aerial photograph; not a surveyed railway route. */
export class WetlandDetails {
  readonly group = new THREE.Group()
  private stamp = ''
  private dummy = new THREE.Object3D()
  private parts: THREE.InstancedMesh[] = []
  private trunk: THREE.InstancedMesh
  private crown: THREE.InstancedMesh
  private walls: THREE.InstancedMesh
  private roofs: THREE.InstancedMesh
  private windows: THREE.InstancedMesh
  private paths: THREE.InstancedMesh

  private height: (x: number, z: number) => number
  constructor(height: (x: number, z: number) => number) {
    this.height = height
    const make = (geometry: THREE.BufferGeometry, color: number, count: number) => {
      const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.9 }), count)
      mesh.frustumCulled = false
      this.group.add(mesh)
      this.parts.push(mesh)
      return mesh
    }
    this.trunk = make(new THREE.CylinderGeometry(0.12, 0.18, 2.1, 5), 0x716449, 180)
    const a = new THREE.PlaneGeometry(3.8, 4.2)
    a.translate(0, 2.1, 0)
    applyAtlasUV(a, 1, 0, 4, 2)
    const b = a.clone()
    b.rotateY(Math.PI / 2)
    this.crown = make(mergeGeometries([a, b]), 0xffffff, 180)
    a.dispose()
    b.dispose()
    const foliage = this.crown.material as THREE.MeshStandardMaterial
    foliage.map = treeNearTex
    foliage.side = THREE.DoubleSide
    foliage.alphaTest = 0.45
    this.walls = make(new THREE.BoxGeometry(1, 1, 1), 0xe1ddc9, 9)
    // Roof cross-section: two pitched planes, with a continuous ridge.
    const roof = new THREE.BufferGeometry()
    roof.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.6, 0, -0.6, 0, 0.35, -0.6, -0.6, 0, 0.6,
      -0.6, 0, 0.6, 0, 0.35, -0.6, 0, 0.35, 0.6,
      0, 0.35, -0.6, 0.6, 0, -0.6, 0.6, 0, 0.6,
      0, 0.35, -0.6, 0.6, 0, 0.6, 0, 0.35, 0.6,
    ], 3))
    roof.setIndex([0, 2, 1, 3, 5, 4, 6, 8, 7, 9, 11, 10])
    roof.computeVertexNormals()
    this.roofs = make(roof, 0x505c5c, 9)
    this.windows = make(new THREE.BoxGeometry(0.04, 1.1, 0.85), 0x384e53, 54)
    this.paths = make(new THREE.BoxGeometry(1, 1, 1), 0xb4aa86, 12)
  }

  private put(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) {
    this.dummy.position.set(x, y, z)
    this.dummy.rotation.set(0, 0, 0)
    this.dummy.scale.set(sx, sy, sz)
    this.dummy.updateMatrix()
    mesh.setMatrixAt(i, this.dummy.matrix)
  }

  update(z: number, isField: (z: number) => boolean) {
    const first = Math.floor(z / 100) - 2
    if (this.stamp === String(first)) return
    this.stamp = String(first)
    let tree = 0
    for (let row = 0; row < 12; row++) {
      const wz = (first + row) * 100
      const active = isField(wz + 20) && isField(wz + 90)
      this.put(this.paths, row, 145, this.height(145, wz) + 0.04, wz, active ? 220 : 0, 0.06, 2)
      for (let lane = 0; lane < 3; lane++) for (let j = 0; j < 5; j++) {
        const tz = wz + 12 + j * 17
        const x = FIELD_LANES[lane].x - FIELD_LANES[lane].width / 2 + 1.1
        const y = this.height(x, tz)
        const s = active ? 0.85 + hash01(lane, tz, 84) * 0.4 : 0
        this.put(this.trunk, tree, x, y + 0.9, tz, 0, 0, 0)
        this.put(this.crown, tree, x, y, tz, s, s * 0.85, s)
        tree++
      }
    }
    let building = 0
    let window = 0
    for (let slot = 0; slot < 3; slot++) {
      const anchor = (Math.floor(z / 400) - 1 + slot) * 400 + 190
      for (let j = 0; j < 3; j++) {
        const x = 240 + (j % 2) * 14
        const bz = anchor + j * 15
        const y = this.height(x, bz)
        const active = isField(bz) ? 1 : 0
        const h = j === 0 ? 6 : 3.5
        this.put(this.walls, building, x, y + h / 2, bz, 8 * active, h * active, 11 * active)
        this.put(this.roofs, building++, x, y + h, bz, 8 * active, 6 * active, 11 * active)
        for (let floor = 0; floor < 2; floor++) for (let w = 0; w < 3; w++) {
          this.put(this.windows, window++, x - 4.03, y + 1.5 + floor * 2.6, bz - 3 + w * 3, active, floor === 0 || h === 6 ? active : 0, active)
        }
      }
    }
    for (const part of this.parts) part.instanceMatrix.needsUpdate = true
  }

  dispose() {
    for (const mesh of this.parts) {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
      mesh.dispose()
    }
  }
}
