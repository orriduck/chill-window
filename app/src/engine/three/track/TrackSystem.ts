import * as THREE from 'three'

const RAIL_GAUGE = 1.5
const SEGMENT = 400 // track length that follows the camera (uniform, no seam)
const SLEEPER_SPACING = 1.2
const SLEEPER_COUNT = Math.ceil(SEGMENT / SLEEPER_SPACING)
const FENCE_X = 5.5 // lineside fence on the window side, inside the corridor
const FENCE_SPACING = 6
const FENCE_COUNT = Math.ceil(SEGMENT / FENCE_SPACING)

/**
 * The permanent way: ballast strip, twin rails and sleepers.
 * Everything is uniform along Z, so the whole group follows the camera;
 * sleepers stay on a fixed world lattice via a modulo offset.
 */
export class TrackSystem {
  readonly group = new THREE.Group()
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = []
  private sleepers: THREE.InstancedMesh
  private fencePosts: THREE.InstancedMesh
  private dummy = new THREE.Object3D()

  constructor() {
    const ballastMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x7d7468, roughness: 1.0, metalness: 0 })
    )
    const steelMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x9a9a9e, roughness: 0.3, metalness: 0.9 })
    )
    const sleeperMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 0.95, metalness: 0 })
    )
    const postMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9, metalness: 0 })
    )
    const fenceWireMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x777770, roughness: 0.5, metalness: 0.6 })
    )

    // Ballast bed: slightly raised trapezoid-ish strip
    const ballast = new THREE.Mesh(this.box(8, 0.18, SEGMENT), ballastMat)
    ballast.position.y = 0.09
    ballast.receiveShadow = true
    this.group.add(ballast)

    // Twin rails
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(this.box(0.09, 0.16, SEGMENT), steelMat)
      rail.position.set(side * (RAIL_GAUGE / 2), 0.26, 0)
      rail.castShadow = true
      this.group.add(rail)
    }

    // Sleepers (instanced)
    const sleeperGeom = this.track(new THREE.BoxGeometry(2.4, 0.12, 0.3))
    this.sleepers = new THREE.InstancedMesh(sleeperGeom, sleeperMat, SLEEPER_COUNT)
    this.sleepers.castShadow = true
    this.sleepers.receiveShadow = true
    for (let i = 0; i < SLEEPER_COUNT; i++) {
      this.dummy.position.set(0, 0.16, i * SLEEPER_SPACING - SEGMENT / 2)
      this.dummy.updateMatrix()
      this.sleepers.setMatrixAt(i, this.dummy.matrix)
    }
    this.group.add(this.sleepers)

    // Lineside fence on the window side: posts + two wire strands.
    // Uniform along Z, so it follows the camera like the rest of the track.
    const postGeom = this.track(new THREE.BoxGeometry(0.09, 1.1, 0.09))
    postGeom.translate(0, 0.55, 0)
    this.fencePosts = new THREE.InstancedMesh(postGeom, postMat, FENCE_COUNT)
    this.fencePosts.castShadow = true
    for (let i = 0; i < FENCE_COUNT; i++) {
      this.dummy.position.set(FENCE_X, 0, i * FENCE_SPACING - SEGMENT / 2)
      this.dummy.updateMatrix()
      this.fencePosts.setMatrixAt(i, this.dummy.matrix)
    }
    this.group.add(this.fencePosts)

    for (const wireY of [0.6, 1.0]) {
      const strand = new THREE.Mesh(this.box(0.03, 0.03, SEGMENT), fenceWireMat)
      strand.position.set(FENCE_X, wireY, 0)
      this.group.add(strand)
    }
  }

  /** Follow the camera along Z; sleepers/fence re-align to the world lattice. */
  update(camZ: number) {
    this.group.position.z = camZ
    // Shift instanced lattices so world positions stay continuous
    this.sleepers.position.z = -(camZ % SLEEPER_SPACING)
    this.fencePosts.position.z = -(camZ % FENCE_SPACING)
  }

  private box(w: number, h: number, d: number): THREE.BoxGeometry {
    return this.track(new THREE.BoxGeometry(w, h, d))
  }

  private track<T extends THREE.BufferGeometry | THREE.Material>(resource: T): T {
    this.disposables.push(resource)
    return resource
  }

  dispose() {
    for (const resource of this.disposables) resource.dispose()
    this.disposables = []
    this.sleepers.dispose()
    this.fencePosts.dispose()
  }
}
