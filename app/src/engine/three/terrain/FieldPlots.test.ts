import { describe, expect, it } from 'vitest'
import { shouldShowFieldBale } from './FieldPlots'

describe('field bale visibility', () => {
  it('keeps agricultural props inside the active field biome', () => {
    expect(shouldShowFieldBale(true)).toBe(true)
    expect(shouldShowFieldBale(false)).toBe(false)
  })
})
