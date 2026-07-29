import * as THREE from 'three'

export class WebGLRenderer {
  renderer: THREE.WebGLRenderer

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setClearColor(0x111111)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    // Filmic tone mapping: richer highlights, less flat-poster colors.
    // (Custom ShaderMaterials like the sky dome bypass this and stay as authored.)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15
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
