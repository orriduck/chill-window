import { describe, expect, it } from 'vitest'
import { journeyBannerText } from './journey'

describe('journey passenger banner', () => {
  const base = { paused: false, dwelling: false, approaching: false, stationName: '折柳' }

  it('announces the next stop only once physical station braking has begun', () => {
    expect(journeyBannerText(base)).toBe('开往 折柳站')
    expect(journeyBannerText({ ...base, approaching: true })).toBe('即将到达 折柳站')
  })

  it('keeps dwell and pause states ahead of an old approach flag', () => {
    expect(journeyBannerText({ ...base, approaching: true, dwelling: true })).toBe('列车经停中')
    expect(journeyBannerText({ ...base, approaching: true, dwelling: true, paused: true })).toBe('行程已暂停')
  })
})
