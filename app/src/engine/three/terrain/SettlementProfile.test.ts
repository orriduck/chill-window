import { describe, expect, it } from 'vitest'
import { townProfileForSettlement } from './SettlementProfile'

describe('settlement profiles', () => {
  it('only upgrades an urban-edge route beat to an urban district', () => {
    expect(townProfileForSettlement('regional-town')).toBe('regional')
    expect(townProfileForSettlement('urban-edge')).toBe('urban')
    expect(townProfileForSettlement('village')).toBeNull()
  })
})
