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
  warmupMs = 0

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.info.autoReset = false
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
    this.renderer.info.reset()
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

  async warmup(scene: THREE.Scene, camera: THREE.Camera, preparedWorld?: THREE.Object3D) {
    const started = performance.now()
    await this.renderer.compileAsync(scene, camera)
    if (preparedWorld) await this.uploadPreparedObject(scene, camera, preparedWorld)
    this.warmupMs = performance.now() - started
  }

  async preload(scene: THREE.Scene, camera: THREE.Camera, preparedWorld: THREE.Object3D) {
    await this.renderer.compileAsync(preparedWorld, camera, scene)
    await this.uploadPreparedObject(scene, camera, preparedWorld)
  }

  private async uploadPreparedObject(scene: THREE.Scene, camera: THREE.Camera, preparedWorld: THREE.Object3D) {
    const started = performance.now()
    // Shader compilation alone does not upload hidden geometry. Submit all
    // already prepared world batches to a tiny offscreen target once. No
    // visibility change survives this synchronous pass or reaches the canvas.
    const states: Array<{ object: THREE.Object3D; visible: boolean; culled: boolean; upload: boolean }> = []
    const scope = new Set<THREE.Object3D>()
    preparedWorld.traverse(object => { scope.add(object); states.push({ object, visible: object.visible, culled: object.frustumCulled, upload: true }) })
    for (let parent = preparedWorld.parent; parent; parent = parent.parent) states.push({ object: parent, visible: parent.visible, culled: parent.frustumCulled, upload: true })
    // Future chunks need only their own buffer submission, not another full
    // world draw. Keep the real objects/attributes so the original instance
    // buffers are uploaded, and preserve all lights and parent transforms.
    scene.traverse(object => {
      if (!scope.has(object) && (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points || object instanceof THREE.Sprite)) states.push({ object, visible: object.visible, culled: object.frustumCulled, upload: false })
    })
    const target = new THREE.WebGLRenderTarget(16, 16)
    const previousTarget = this.renderer.getRenderTarget()
    const shadowAutoUpdate = this.renderer.shadowMap.autoUpdate
    try {
      for (const state of states) { state.object.visible = state.upload; if (state.upload) state.object.frustumCulled = false }
      this.renderer.shadowMap.autoUpdate = false
      this.renderer.setRenderTarget(target)
      this.renderer.render(scene, camera)
    } finally {
      for (const state of states) { state.object.visible = state.visible; state.object.frustumCulled = state.culled }
      this.renderer.setRenderTarget(previousTarget)
      this.renderer.shadowMap.autoUpdate = shadowAutoUpdate
      target.dispose()
    }
    // Await completion without blocking the UI thread with gl.finish().
    const gl = this.renderer.getContext()
    if (!('fenceSync' in gl)) throw new Error('场景 GPU 预热需要 WebGL2')
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    if (!fence) throw new Error('无法建立场景 GPU 预热同步点')
    gl.flush()
    try {
      await new Promise<void>((resolve, reject) => {
        const poll = () => {
          const status = gl.clientWaitSync(fence, 0, 0)
          if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) resolve()
          else if (status === gl.WAIT_FAILED || gl.isContextLost()) reject(new Error('场景 GPU 预热失败'))
          else if (performance.now() - started > 180000) reject(new Error('场景 GPU 预热超时'))
          else window.setTimeout(poll, 16)
        }
        poll()
      })
    } finally { gl.deleteSync(fence) }
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
