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
  private uploadedVersions = new WeakMap<THREE.BufferAttribute | THREE.InterleavedBuffer, number>()
  private submittedSharedModels = new WeakMap<THREE.BufferGeometry, Set<THREE.Material>>()

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

  async preload(scene: THREE.Scene, camera: THREE.Camera, preparedWorld: THREE.Object3D[]) {
    for (const group of preparedWorld) await this.renderer.compileAsync(group, camera, scene)
    await this.uploadPreparedObject(scene, camera, preparedWorld)
  }

  private async uploadPreparedObject(scene: THREE.Scene, camera: THREE.Camera, preparedWorld: THREE.Object3D | THREE.Object3D[]) {
    const started = performance.now()
    // Shader compilation alone does not upload hidden geometry. Submit all
    // already prepared world batches to a tiny offscreen target once. No
    // visibility change survives this synchronous pass or reaches the canvas.
    const states: Array<{ object: THREE.Object3D; visible: boolean; culled: boolean; upload: boolean; instanceCount?: number }> = []
    const scope = new Set<THREE.Object3D>()
    const recorded = new Set<THREE.Object3D>()
    const record = (object: THREE.Object3D, upload: boolean) => {
      if (recorded.has(object)) return
      recorded.add(object)
      states.push({ object, visible: object.visible, culled: object.frustumCulled, upload, instanceCount: object instanceof THREE.InstancedMesh ? object.count : undefined })
    }
    for (const group of Array.isArray(preparedWorld) ? preparedWorld : [preparedWorld]) {
      group.traverse(object => { scope.add(object); record(object, true) })
      for (let parent = group.parent; parent; parent = parent.parent) record(parent, true)
    }
    // Future chunks need only their own buffer submission, not another full
    // world draw. Keep the real objects/attributes so the original instance
    // buffers are uploaded, and preserve all lights and parent transforms.
    scene.traverse(object => {
      if (!scope.has(object) && (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points || object instanceof THREE.Sprite)) record(object, false)
    })
    const target = new THREE.WebGLRenderTarget(16, 16)
    const previousTarget = this.renderer.getRenderTarget()
    const shadowAutoUpdate = this.renderer.shadowMap.autoUpdate
    const buffers = new Map<THREE.BufferAttribute | THREE.InterleavedBuffer, () => void>()
    const sharedSubmissions: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }> = []
    const observe = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => {
      const buffer = attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data : attribute
      if (buffers.has(buffer)) return
      const callback = buffer.onUploadCallback
      buffers.set(buffer, callback)
      buffer.onUploadCallback = () => { callback.call(buffer); this.uploadedVersions.set(buffer, buffer.version) }
    }
    for (const object of scope) if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
      for (const attribute of Object.values(object.geometry.attributes) as Array<THREE.BufferAttribute | THREE.InterleavedBufferAttribute>) observe(attribute)
      if (object.geometry.index) observe(object.geometry.index)
      if (object instanceof THREE.InstancedMesh) {
        observe(object.instanceMatrix)
        if (object.instanceColor) observe(object.instanceColor)
      }
    }
    try {
      for (const state of states) {
        state.object.visible = state.upload
        if (state.upload) {
          state.object.frustumCulled = false
          if (state.object instanceof THREE.InstancedMesh) {
            const mesh = state.object
            const material = Array.isArray(mesh.material) ? null : mesh.material
            const submitted = this.submittedSharedModels.get(mesh.geometry)
            // WebGLObjects uploads each instance attribute before rendering.
            // Draw one instance for the first shared model/material, then
            // submit zero-count siblings to upload their individual buffers
            // without repeatedly rasterizing the same source crown.
            const alreadySubmitted = material && mesh.userData.sharedGeometry && (submitted?.has(material)
              || sharedSubmissions.some(item => item.geometry === mesh.geometry && item.material === material))
            mesh.count = alreadySubmitted ? 0 : Math.min(1, mesh.count)
            if (material && mesh.userData.sharedGeometry && !alreadySubmitted) sharedSubmissions.push({ geometry: mesh.geometry, material })
          }
        }
      }
      this.renderer.shadowMap.autoUpdate = false
      this.renderer.setRenderTarget(target)
      this.renderer.render(scene, camera)
      const missing = [...buffers.keys()].filter(buffer => this.uploadedVersions.get(buffer) !== buffer.version)
      if (missing.length) throw new Error(`场景 GPU 预热有 ${missing.length} 个未证实上传的缓冲`)
    } finally {
      for (const [buffer, callback] of buffers) buffer.onUploadCallback = callback
      for (const state of states) {
        state.object.visible = state.visible; state.object.frustumCulled = state.culled
        if (state.object instanceof THREE.InstancedMesh && state.instanceCount !== undefined) state.object.count = state.instanceCount
      }
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
    for (const { geometry, material } of sharedSubmissions) {
      const submitted = this.submittedSharedModels.get(geometry) ?? new Set<THREE.Material>()
      submitted.add(material); this.submittedSharedModels.set(geometry, submitted)
    }
    // Publish proof only after both observed buffer upload and GPU fence.
    // A future-chunk gate cannot pass from compileAsync or metadata alone.
    for (const object of scope) if (object instanceof THREE.InstancedMesh) {
      object.userData.preparedInstanceBufferVersion = object.instanceMatrix.version
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
