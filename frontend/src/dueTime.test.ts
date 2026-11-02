import { describe, expect, it } from 'vitest'
import { describeDueTime, zoneName } from './dueTime'
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
