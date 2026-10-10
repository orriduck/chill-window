import { afterEach, describe, expect, it, vi } from 'vitest'
import { DepartureScheduler, journeyBannerText, journeyClockDelta } from './journey'

describe('journey preparation clock gate', () => {
  it('charges only the ready portion of a RAF spanning the final GPU fence', () => {
    const state = { presentable: true, paused: false, inspecting: false };
    // Previous RAF=1000ms, current RAF=1500ms, actual readiness=1375ms.
    expect(journeyClockDelta(0.5, { ...state, readyAgeSeconds: (1500 - 1375) / 1000 })).toBe(0.125);
    // A retained world was prepared before the complete current frame.
    expect(journeyClockDelta(0.5, { ...state, readyAgeSeconds: 30 })).toBe(0.5);
    expect(journeyClockDelta(0.5, { ...state, readyAgeSeconds: 0 })).toBe(0);
    expect(journeyClockDelta(0.5, { ...state, readyAgeSeconds: -0.1 })).toBe(0);
    expect(journeyClockDelta(0.5, { ...state, readyAgeSeconds: NaN })).toBe(0);
    expect(journeyClockDelta(0.5, { ...state, paused: true, readyAgeSeconds: 30 })).toBe(0);
    expect(journeyClockDelta(0.5, { ...state, inspecting: true, readyAgeSeconds: 30 })).toBe(0);
  });

  it('holds focus and segment progress through source and GPU preparation, then advances while stationary', () => {
    let focus = 0, segment = 0
    const tick = (seconds: number, presentable: boolean, paused = false, inspecting = false) => {
      const elapsed = journeyClockDelta(seconds, { presentable, paused, inspecting })
      focus += elapsed; segment += elapsed
    }
    tick(45, false) // held source pack
    tick(20, false) // decoded world, GPU fence still pending
    expect([focus, segment]).toEqual([0, 0])
    tick(3, true) // departure may still be stationary; readiness owns the gate
    expect([focus, segment]).toEqual([3, 3])
    tick(10, true, true); tick(15, true, false, true)
    expect([focus, segment]).toEqual([3, 3])
    tick(5, false) // later preparation error holds clocks again
    expect([focus, segment]).toEqual([3, 3])
    tick(2, true)
    expect([focus, segment]).toEqual([5, 5])
  })
})

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
