import * as THREE from 'three'

export class Scene3D {
  scene: THREE.Scene

  constructor() {
    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog(0xcccccc, 100, 500)

    const grid = new THREE.GridHelper(500, 50, 0x888888, 0xcccccc)
    grid.position.y = -0.01
    this.scene.add(grid)
  }

  add(object: THREE.Object3D) {
    this.scene.add(object)
  }

  remove(object: THREE.Object3D) {
    this.scene.remove(object)
  }

  dispose() {
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose())
        } else {
          obj.material.dispose()
        }
      }
    })
  }
}
