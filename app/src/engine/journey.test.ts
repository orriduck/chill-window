import { afterEach, describe, expect, it, vi } from 'vitest'
import { DepartureScheduler, journeyBannerText } from './journey'

describe('journey passenger banner', () => {
  const base = { paused: false, dwelling: false, approaching: false, stationName: 'Willow Bend' }

  it('announces the next stop only once physical station braking has begun', () => {
    expect(journeyBannerText(base)).toBe('Towards Willow Bend')
    expect(journeyBannerText({ ...base, approaching: true })).toBe('Approaching Willow Bend')
  })

  it('keeps dwell and pause states ahead of an old approach flag', () => {
    expect(journeyBannerText({ ...base, approaching: true, dwelling: true })).toBe('At station')
    expect(journeyBannerText({ ...base, approaching: true, dwelling: true, paused: true })).toBe('Journey paused')
  })
})

describe('origin departure scheduler', () => {
  afterEach(() => vi.useRealTimers())

  it('does not leave a stopped journey with a stale departure callback', () => {
    vi.useFakeTimers()
    const depart = vi.fn()
    const scheduler = new DepartureScheduler()

    scheduler.schedule(depart, 2600)
    scheduler.cancel()
    vi.advanceTimersByTime(2600)

    expect(depart).not.toHaveBeenCalled()
  })

  it('replaces an earlier departure when a new journey begins', () => {
    vi.useFakeTimers()
    const firstDeparture = vi.fn()
    const nextDeparture = vi.fn()
    const scheduler = new DepartureScheduler()

    scheduler.schedule(firstDeparture, 2600)
    scheduler.schedule(nextDeparture, 2600)
    vi.advanceTimersByTime(2600)

    expect(firstDeparture).not.toHaveBeenCalled()
    expect(nextDeparture).toHaveBeenCalledOnce()
  })
})
