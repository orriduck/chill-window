import * as THREE from 'three'

/**
 * Lightweight performance monitor overlay.
 * Toggle with F3. Renders a small HUD in the top-left corner.
 */
export class PerfMonitor {
  private el: HTMLDivElement
  private visible = false
  private frames = 0
  private lastTime = 0
  private fps = 0
  private frameTime = 0
  private renderer: THREE.WebGLRenderer

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer
    this.el = document.createElement('div')
    this.el.style.cssText = `
      position: fixed; top: 8px; left: 8px; z-index: 9999;
      background: rgba(0,0,0,0.75); color: #0f0; font: 11px/1.4 monospace;
      padding: 8px 10px; border-radius: 6px; pointer-events: none;
      display: none; white-space: pre;
    `
    document.body.appendChild(this.el)
    this.lastTime = performance.now()
    window.addEventListener('keydown', this.onKey)
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'F3') {
      e.preventDefault()
      this.toggle()
    }
  }

  toggle() {
    this.visible = !this.visible
    this.el.style.display = this.visible ? 'block' : 'none'
  }

  /** Call once per frame after renderer.render(). */
  update() {
    this.frames++
    const now = performance.now()
    const delta = now - this.lastTime

    if (delta >= 500) {
      this.fps = Math.round((this.frames * 1000) / delta)
      this.frameTime = Math.round((delta / this.frames) * 10) / 10
      this.frames = 0
      this.lastTime = now

      if (this.visible) {
        const info = this.renderer.info
        this.el.textContent =
          `FPS ${this.fps}  (${this.frameTime}ms)\n` +
          `Draw ${info.render.calls}  Tri ${(info.render.triangles / 1000).toFixed(1)}k\n` +
          `Geo ${info.memory.geometries}  Tex ${info.memory.textures}`
      }
    }
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey)
    this.el.remove()
  }
}
