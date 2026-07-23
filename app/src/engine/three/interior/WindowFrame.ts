import * as THREE from 'three'

const FRAME_DISTANCE = 2
const OPENING_W = 2.6
const OPENING_H = 1.6
const FRAME_T = 0.14
const FRAME_D = 0.08

/**
 * Train window frame pinned in front of the camera, giving the
 * "looking out of a train window" feel.
 */
export class WindowFrame {
  readonly group = new THREE.Group()
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = []
  private tmpDir = new THREE.Vector3()

  constructor() {
    const wood = this.track(
      new THREE.MeshStandardMaterial({ color: 0x3d2817, roughness: 0.7, metalness: 0.1 })
    )
    const metal = this.track(
      new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.35, metalness: 0.8 })
    )

    const halfW = OPENING_W / 2 + FRAME_T / 2
    const halfH = OPENING_H / 2 + FRAME_T / 2

    // Left / right pillars
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(this.box(FRAME_T, OPENING_H + FRAME_T * 2, FRAME_D), wood)
      pillar.position.set(side * halfW, 0, 0)
      this.group.add(pillar)
    }
    // Top bar
    const top = new THREE.Mesh(this.box(OPENING_W + FRAME_T * 2, FRAME_T, FRAME_D), wood)
    top.position.set(0, halfH, 0)
    this.group.add(top)
    // Bottom frame bar
    const bottom = new THREE.Mesh(this.box(OPENING_W + FRAME_T * 2, FRAME_T, FRAME_D), wood)
    bottom.position.set(0, -halfH, 0)
    this.group.add(bottom)

    // Window sill: extends toward the viewer, holds small objects
    const sill = new THREE.Mesh(this.box(OPENING_W + FRAME_T * 2, 0.06, 0.3), wood)
    sill.position.set(0, -halfH - 0.06, 0.16)
    this.group.add(sill)

    // Metal trim along the inner edges
    const trimV = this.box(0.02, OPENING_H, FRAME_D + 0.01)
    for (const side of [-1, 1]) {
      const trim = new THREE.Mesh(trimV, metal)
      trim.position.set(side * (OPENING_W / 2 + 0.01), 0, 0)
      this.group.add(trim)
    }

    // Glass: nearly invisible plane with a faint reflective hint
    const glass = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(OPENING_W, OPENING_H)),
      this.track(
        new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.06,
          roughness: 0.05,
          metalness: 0,
          depthWrite: false,
        })
      )
    )
    glass.renderOrder = 10
    this.group.add(glass)

    this.addSillObjects()
  }

  private addSillObjects() {
    const sillTop = -(OPENING_H / 2 + FRAME_T) - 0.03

    // Cup
    const cup = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.045, 0.035, 0.1, 12)),
      this.track(new THREE.MeshStandardMaterial({ color: 0xd4553a, roughness: 0.5 }))
    )
    cup.position.set(-0.8, sillTop + 0.08, 0.16)
    this.group.add(cup)

    // Book (flat box, slightly rotated)
    const book = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(0.22, 0.03, 0.16)),
      this.track(new THREE.MeshStandardMaterial({ color: 0x2a4a6a, roughness: 0.8 }))
    )
    book.position.set(0.3, sillTop + 0.045, 0.18)
    book.rotation.y = 0.3
    this.group.add(book)

    // Small plant pot
    const pot = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.05, 0.04, 0.08, 10)),
      this.track(new THREE.MeshStandardMaterial({ color: 0xa0643c, roughness: 0.9 }))
    )
    pot.position.set(0.85, sillTop + 0.07, 0.15)
    this.group.add(pot)
    const plant = new THREE.Mesh(
      this.track(new THREE.IcosahedronGeometry(0.06, 0)),
      this.track(new THREE.MeshStandardMaterial({ color: 0x3f7a3f, roughness: 0.8, flatShading: true }))
    )
    plant.position.set(0.85, sillTop + 0.16, 0.15)
    this.group.add(plant)
  }

  /** Pin the frame to the camera: always the same spot in view. */
  update(camera: THREE.PerspectiveCamera) {
    camera.getWorldDirection(this.tmpDir)
    this.group.position.copy(camera.position).addScaledVector(this.tmpDir, FRAME_DISTANCE)
    this.group.quaternion.copy(camera.quaternion)
  }

  private box(w: number, h: number, d: number): THREE.BoxGeometry {
    return this.track(new THREE.BoxGeometry(w, h, d))
  }

  private track<T extends THREE.BufferGeometry | THREE.Material>(resource: T): T {
    this.disposables.push(resource)
    return resource
  }

  dispose() {
    for (const resource of this.disposables) {
      resource.dispose()
    }
    this.disposables = []
  }
}
