import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { renderPixelRatio, WebGLRenderer } from './Renderer'

describe('renderPixelRatio', () => {
  it('keeps desktop Retina rendering capped at DPR 2', () => {
    expect(renderPixelRatio(3, 1728, 1117, false)).toBe(2)
    expect(renderPixelRatio(1.5, 1440, 900, false)).toBe(1.5)
  })

  it('limits compact touch displays while retaining antialiasing detail', () => {
    expect(renderPixelRatio(3, 393, 852, true)).toBe(1.25)
    expect(renderPixelRatio(2, 852, 393, true)).toBe(1.25)
  })

  it('does not apply the phone cap to a larger coarse-pointer viewport', () => {
    expect(renderPixelRatio(2, 1024, 768, true)).toBe(2)
    expect(renderPixelRatio(0.75, 1024, 768, true)).toBe(1)
  })
})

// Exercise scheduling without creating a WebGL context. These checks prove
// draw suppression/resumption; they do not prove real driver fence completion.
describe('canvas submissions during genuine GPU preparation', () => {
  const scheduler = () => {
    const value = Object.create(WebGLRenderer.prototype) as WebGLRenderer
    const draw = vi.fn(), reset = vi.fn(), clearDepth = vi.fn()
    Object.assign(value, {
      renderer: { render: draw, info: { reset }, autoClear: true, clearDepth },
      presentation: { submittedFrames: 0, deferredFrames: 0, held: false, lastSubmittedAt: 0 },
      preparation: { phase: 'compile' },
    })
    return { value, draw, reset, clearDepth }
  }
  it('keeps the previous canvas frame throughout compile/upload/fence', () => {
    const { value, draw, reset, clearDepth } = scheduler()
    for (const phase of ['compile', 'upload', 'fence']) {
      value.preparation.phase = phase
      expect(value.render(new THREE.Scene(), new THREE.Camera(), new THREE.Scene())).toBe(false)
    }
    expect(draw).not.toHaveBeenCalled()
    expect(reset).not.toHaveBeenCalled()
    expect(clearDepth).not.toHaveBeenCalled()
    expect(value.presentation).toMatchObject({ held: true, submittedFrames: 0, deferredFrames: 3 })
  })
  it('resumes both exterior and cabin only when preparation is idle', () => {
    const { value, draw, reset, clearDepth } = scheduler()
    value.preparation.phase = 'fence'
    expect(value.render(new THREE.Scene(), new THREE.Camera())).toBe(false)
    value.preparation.phase = 'idle'
    const exterior = new THREE.Scene(), interior = new THREE.Scene(), camera = new THREE.Camera()
    expect(value.render(exterior, camera, interior)).toBe(true)
    expect(draw.mock.calls).toEqual([[exterior, camera], [interior, camera]])
    expect(reset).toHaveBeenCalledOnce()
    expect(clearDepth).toHaveBeenCalledOnce()
    expect(value.presentation).toMatchObject({ held: false, submittedFrames: 1, deferredFrames: 1 })
    expect(value.renderer.autoClear).toBe(true)
  })
})
