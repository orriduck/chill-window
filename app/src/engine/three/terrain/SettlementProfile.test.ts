import { describe, expect, it } from 'vitest'
import { townProfileForSettlement } from './SettlementProfile'

describe('settlement profiles', () => {
  it('distinguishes village, regional town, suburb and city core', () => {
    expect(townProfileForSettlement('regional-town')).toBe('regional')
    expect(townProfileForSettlement('urban-edge')).toBe('urban')
    expect(townProfileForSettlement('village')).toBe('village')
    expect(townProfileForSettlement('city-core')).toBe('metro')
    expect(townProfileForSettlement('none')).toBeNull()
  })
})
