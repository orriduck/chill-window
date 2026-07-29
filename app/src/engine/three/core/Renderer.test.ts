import { describe, expect, it } from 'vitest'
import { renderPixelRatio } from './Renderer'

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
