import * as THREE from 'three'

export class TrainCamera {
  camera: THREE.PerspectiveCamera

  constructor() {
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000)
    this.camera.position.set(0, 2, 5)
    this.camera.lookAt(0, 1.5, 20)
  }

  updateAspect(width: number, height: number) {
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  update(dt: number) {
    const z = this.camera.position.z + 15 * dt
    this.camera.position.set(0, 2, z)
    this.camera.lookAt(0, 1.5, z + 50)
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera
  }
}
