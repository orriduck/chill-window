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

  render(scene: THREE.Scene, camera: THREE.Camera, foreground?: THREE.Scene) {
    this.renderer.render(scene, camera)
    if (foreground) {
      // The carriage is a separate foreground pass. Transparent exterior
      // effects (snow/rain) have already been rendered, so they cannot draw
      // over opaque interior panels on a later transparent pass.
      const autoClear = this.renderer.autoClear
      this.renderer.autoClear = false
      this.renderer.clearDepth()
      this.renderer.render(foreground, camera)
      this.renderer.autoClear = autoClear
    }
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
