import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  browserZone,
  describeDueTime,
  forgetZones,
  offerable,
  timeZones,
  zoneName,
} from './dueTime'
import { de, en } from './i18n/messages'

const task = { dueDate: '2026-10-12' }

/** The phone's or browser's clock, as a fixed offset from UTC, so the tests run in any zone. */
function clockAt(offsetHours: number) {
  return (instant: Date) => {
    const shifted = new Date(instant.getTime() + offsetHours * 3_600_000)
    return { date: shifted.toISOString().slice(0, 10), time: shifted.toISOString().slice(11, 16) }
  }
}

describe('describeDueTime', () => {
  it('says nothing for a task without a time', () => {
    expect(describeDueTime(task, en.dates, 'en', clockAt(0))).toBeNull()
  })

  it('says the time alone for a task that follows wherever its owner is', () => {
    expect(describeDueTime({ ...task, dueTime: '10:00' }, en.dates, 'en', clockAt(-6))).toBe('10:00')
  })

  it('says the time alone for a zoned task that is due at the same time here', () => {
    const berlin = { ...task, dueTime: '10:00', timeZone: 'Europe/Berlin', dueAt: '2026-10-12T08:00:00Z' }
    expect(describeDueTime(berlin, en.dates, 'en', clockAt(2))).toBe('10:00')
  })

  it("names the task's zone and the time here when they differ", () => {
    const berlin = { ...task, dueTime: '10:00', timeZone: 'Europe/Berlin', dueAt: '2026-10-12T08:00:00Z' }
    expect(describeDueTime(berlin, en.dates, 'en', clockAt(-4))).toBe('10:00 (Berlin), 04:00 here')
    expect(describeDueTime(berlin, de.dates, 'de', clockAt(-4))).toBe('10:00 (Berlin), hier 04:00')
  })

  it('names both days when here it is due on another day', () => {
    const berlin = {
      dueDate: '2026-10-13', dueTime: '01:00', timeZone: 'Europe/Berlin', dueAt: '2026-10-12T23:00:00Z',
    }
    expect(describeDueTime(berlin, en.dates, 'en', clockAt(-4))).toBe('Tue 01:00 (Berlin), Mon 19:00 here')
    expect(describeDueTime(berlin, de.dates, 'de', clockAt(-4))).toBe('Di 01:00 (Berlin), hier Mo 19:00')
  })

  it("reads the moment by this device's own clock unless told otherwise", () => {
    // Local 10:00 on the task's day, in whatever zone the tests run in.
    const local = { ...task, dueTime: '10:00', timeZone: 'Asia/Tokyo', dueAt: new Date(2026, 9, 12, 10).toISOString() }
    expect(describeDueTime(local, en.dates, 'en')).toBe('10:00')
  })

  it('names the zone alone when the moment cannot be read', () => {
    const garbled = { ...task, dueTime: '10:00', timeZone: 'Europe/Berlin', dueAt: 'soon' }
    expect(describeDueTime(garbled, en.dates, 'en')).toBe('10:00 (Berlin)')
  })

  it('names the zone alone when the backend could not say when that is', () => {
    const unknown = { ...task, dueTime: '10:00', timeZone: 'Europe/Berlin', dueAt: null }
    expect(describeDueTime(unknown, en.dates, 'en', clockAt(0))).toBe('10:00 (Berlin)')
  })
})

describe('zoneName', () => {
  it("is a zone's city, as people say it", () => {
    expect(zoneName('Europe/Berlin')).toBe('Berlin')
    expect(zoneName('America/New_York')).toBe('New York')
    expect(zoneName('America/Argentina/Buenos_Aires')).toBe('Buenos Aires')
  })

  it('is UTC or GMT as it is', () => {
    expect(zoneName('UTC')).toBe('UTC')
    expect(zoneName('Etc/UTC')).toBe('UTC')
    expect(zoneName('Etc/GMT')).toBe('GMT')
  })
})

describe('the zones a task can be tied to (#476)', () => {
  afterEach(() => vi.restoreAllMocks())

  it("starts from the browser's zone", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      ...new Intl.DateTimeFormat().resolvedOptions(),
      timeZone: 'Asia/Tokyo',
    })
    expect(browserZone()).toBe('Asia/Tokyo')
  })

  it('starts from UTC where the browser names a fixed offset, which the backend refuses', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      ...new Intl.DateTimeFormat().resolvedOptions(),
      timeZone: 'Etc/GMT-2',
    })
    expect(browserZone()).toBe('UTC')
  })

  it('starts from a zone the list names differently, which the backend takes', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      ...new Intl.DateTimeFormat().resolvedOptions(),
      timeZone: 'Asia/Kolkata',
    })
    expect(browserZone()).toBe('Asia/Kolkata')
    expect(offerable('GMT+1')).toBe('UTC')
    expect(offerable(null)).toBe('UTC')
  })

  it('offers no fixed offsets but UTC, and always the zone a task has', () => {
    const zones = timeZones('Mars/Olympus_Mons')
    expect(zones).toContain('Europe/Berlin')
    expect(zones).toContain('UTC')
    expect(zones).toContain('Mars/Olympus_Mons')
    expect(zones.some((zone) => zone.startsWith('Etc/'))).toBe(false)
  })

  it('offers UTC and the task\'s zone in a browser without the list', () => {
    const list = Intl.supportedValuesOf
    Object.defineProperty(Intl, 'supportedValuesOf', { value: undefined, configurable: true, writable: true })
    forgetZones()
    try {
      expect(timeZones('Europe/Berlin')).toEqual(['Europe/Berlin', 'UTC'])
    } finally {
      Object.defineProperty(Intl, 'supportedValuesOf', { value: list, configurable: true, writable: true })
      forgetZones()
    }
  })
})
