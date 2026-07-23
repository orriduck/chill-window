import * as THREE from 'three'

export class WebGLRenderer {
  renderer: THREE.WebGLRenderer

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setClearColor(0x111111)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer.render(scene, camera)
  }

  resize(width: number, height: number) {
    this.renderer.setSize(width, height, false)
  }

  getDomElement(): HTMLCanvasElement {
    return this.renderer.domElement
  }

  dispose() {
    this.renderer.dispose()
  }
}
