import { describe, expect, it } from 'vitest'
import { TimeOfDay } from './TimeOfDay'

describe('TimeOfDay night readability', () => {
  it('keeps enough moonlight and fog distance to read the side-window landscape', () => {
    const time = new TimeOfDay('night')
    time.update(0)

    expect(time.state.ambientIntensity).toBe(0.24)
    expect(time.state.dirIntensity).toBe(0.35)
    expect(time.state.fogNear).toBe(80)
    expect(time.state.fogFar).toBe(520)
  })

  it('leaves the established daytime and dusk light budgets unchanged', () => {
    const day = new TimeOfDay('day')
    day.update(0)
    expect(day.state.ambientIntensity).toBe(0.45)
    expect(day.state.dirIntensity).toBe(0.9)
    expect(day.state.fogFar).toBe(900)

    const dusk = new TimeOfDay('dusk')
    dusk.update(0)
    expect(dusk.state.ambientIntensity).toBe(0.3)
    expect(dusk.state.dirIntensity).toBe(0.65)
    expect(dusk.state.fogFar).toBe(600)
  })
})
