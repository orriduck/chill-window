import * as THREE from 'three'

const COMPACT_VIEWPORT_MAX = 700
const COMPACT_PIXEL_RATIO_MAX = 1.25
const DESKTOP_PIXEL_RATIO_MAX = 2

/** Keep high-DPI phones within their pixel budget without softening desktop. */
export function renderPixelRatio(
  devicePixelRatio: number,
  width: number,
  height: number,
  hasCoarsePointer: boolean,
): number {
  const compactTouchViewport = hasCoarsePointer && Math.min(width, height) < COMPACT_VIEWPORT_MAX
  const maxRatio = compactTouchViewport ? COMPACT_PIXEL_RATIO_MAX : DESKTOP_PIXEL_RATIO_MAX
  return Math.min(Math.max(devicePixelRatio, 1), maxRatio)
}

export class WebGLRenderer {
  renderer: THREE.WebGLRenderer

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.updatePixelRatio(window.innerWidth, window.innerHeight)
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
    this.updatePixelRatio(width, height)
    this.renderer.setSize(width, height, false)
  }

  private updatePixelRatio(width: number, height: number) {
    const hasCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false
    this.renderer.setPixelRatio(renderPixelRatio(window.devicePixelRatio, width, height, hasCoarsePointer))
  }

  getDomElement(): HTMLCanvasElement {
    return this.renderer.domElement
  }

  dispose() {
    this.renderer.dispose()
  }
}
