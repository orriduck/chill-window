import * as THREE from 'three'

export class TrainCamera {
  camera: THREE.PerspectiveCamera
  private time = 0

  constructor() {
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000)
    this.camera.position.set(0, 2, 5)
    // Side-window view: travel along +Z, look toward +X.
    this.camera.lookAt(50, 1.5, 5)
  }

  updateAspect(width: number, height: number) {
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  update(dt: number) {
    this.time += dt
    const z = this.camera.position.z + 15 * dt
    // Train moves +Z but the window faces +X, so screen-right maps to +Z
    // and the world scrolls right-to-left, like a real side window.
    // Slight forward bias on Z gives a sense of depth up the track.
    this.camera.position.set(0, 2, z)
    this.camera.lookAt(50, 1.5, z + 12)

    // Carriage vibration: layered incommensurate sines feel less mechanical
    const t = this.time
    this.camera.position.y += Math.sin(t * 37) * 0.012 + Math.sin(t * 23 + 1.3) * 0.008
    this.camera.position.x += Math.sin(t * 29 + 0.7) * 0.008
    this.camera.rotateZ(Math.sin(t * 19) * 0.0015)
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera
  }
}
