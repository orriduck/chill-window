import { describe, expect, it } from 'vitest'
import {
  automaticWeatherCandidates,
  isAutomaticWeatherAllowed,
  precipitationKindFor,
  precipitationSpawnY,
  weatherForRoute,
  WeatherType,
} from './WeatherSystem'

describe('automatic weather', () => {
  it('reserves automatic snow for mountain route segments', () => {
    for (const biome of ['field', 'forest', 'town', 'river'] as const) {
      expect(automaticWeatherCandidates(biome)).not.toContain(WeatherType.SNOW)
      expect(isAutomaticWeatherAllowed(WeatherType.SNOW, biome)).toBe(false)
    }

    expect(automaticWeatherCandidates('mountain')).toContain(WeatherType.SNOW)
    expect(isAutomaticWeatherAllowed(WeatherType.SNOW, 'mountain')).toBe(true)
  })

  it('keeps every non-snow weather available across the route', () => {
    for (const biome of ['field', 'forest', 'town', 'river', 'mountain'] as const) {
      expect(isAutomaticWeatherAllowed(WeatherType.CLEAR, biome)).toBe(true)
      expect(isAutomaticWeatherAllowed(WeatherType.CLOUDY, biome)).toBe(true)
      expect(isAutomaticWeatherAllowed(WeatherType.RAIN, biome)).toBe(true)
      expect(isAutomaticWeatherAllowed(WeatherType.FOGGY, biome)).toBe(true)
    }
  })

  it('clears auto snow outside mountains without overriding a manual snow preset', () => {
    expect(weatherForRoute(WeatherType.SNOW, null, 'river')).toBe(WeatherType.CLEAR)
    expect(weatherForRoute(WeatherType.SNOW, null, 'mountain')).toBe(WeatherType.SNOW)
    expect(weatherForRoute(WeatherType.SNOW, WeatherType.SNOW, 'river')).toBe(WeatherType.SNOW)
  })

  it('uses a precipitation sprite only for weather that needs one', () => {
    expect(precipitationKindFor(WeatherType.RAIN)).toBe('rain')
    expect(precipitationKindFor(WeatherType.SNOW)).toBe('snow')
    expect(precipitationKindFor(WeatherType.CLEAR)).toBeNull()
    expect(precipitationKindFor(WeatherType.CLOUDY)).toBeNull()
    expect(precipitationKindFor(WeatherType.FOGGY)).toBeNull()
  })

  it('concentrates rain in the side-window band without changing snow coverage', () => {
    expect(precipitationSpawnY('rain', 2, 0)).toBeCloseTo(0)
    expect(precipitationSpawnY('rain', 2, 1)).toBeCloseTo(34)
    expect(precipitationSpawnY('snow', 2, 1)).toBeCloseTo(80)
    expect(precipitationSpawnY('rain', 2, 2)).toBeCloseTo(34)
  })
})
