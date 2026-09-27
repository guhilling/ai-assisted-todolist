/**
 * Unit tests for the due-date logic.
 *
 * Tested directly rather than through the DOM because this is the only pure logic in the
 * frontend and the only place an off-by-one can hide: the boundaries between "Tomorrow", a
 * weekday name and a plain date are all one day apart, and a month or year rollover looks
 * identical to a correct render unless it is asserted.
 */
import { describe, expect, it } from 'vitest'
import { addDays, bucketOf, daysBetween, describeDueDate, quickDates, todayIso } from './dates'

/** A Thursday, chosen so "within this week" crosses a weekend and a month end. */
const THURSDAY = '2026-10-29'

describe('daysBetween', () => {
  it('counts forwards, backwards and nowhere', () => {
    expect(daysBetween(THURSDAY, '2026-10-30')).toBe(1)
    expect(daysBetween(THURSDAY, '2026-10-28')).toBe(-1)
    expect(daysBetween(THURSDAY, THURSDAY)).toBe(0)
  })

  it('counts across a month and a year boundary', () => {
    expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1)
  })

  it('is not thrown off by a daylight saving change', () => {
    // European clocks go back on 2026-10-25. A local-midnight implementation returns 8 here.
    expect(daysBetween('2026-10-20', '2026-10-27')).toBe(7)
  })
})

describe('addDays', () => {
  it('moves forwards and backwards across boundaries', () => {
    expect(addDays(THURSDAY, 3)).toBe('2026-11-01')
    expect(addDays(THURSDAY, -29)).toBe('2026-09-30')
    expect(addDays('2026-12-30', 2)).toBe('2027-01-01')
  })

  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })
})

describe('describeDueDate', () => {
  it('names the days people think in', () => {
    expect(describeDueDate(THURSDAY, THURSDAY)).toBe('Today')
    expect(describeDueDate('2026-10-30', THURSDAY)).toBe('Tomorrow')
    expect(describeDueDate('2026-10-28', THURSDAY)).toBe('Yesterday')
  })

  it('says how late an overdue task is', () => {
    expect(describeDueDate('2026-10-26', THURSDAY)).toBe('3 days ago')
    expect(describeDueDate('2026-09-29', THURSDAY)).toBe('30 days ago')
  })

  it('uses a weekday name for the rest of the week', () => {
    // Two to six days out, which here runs Saturday to Wednesday across a month end.
    expect(describeDueDate('2026-10-31', THURSDAY)).toBe('Sat')
    expect(describeDueDate('2026-11-04', THURSDAY)).toBe('Wed')
  })

  it('switches to a date once a weekday name stops being useful', () => {
    // Seven days out is the boundary: the same weekday name would be ambiguous.
    expect(describeDueDate('2026-11-05', THURSDAY)).toBe('5 Nov')
    expect(describeDueDate('2026-12-25', THURSDAY)).toBe('25 Dec')
  })

  it('includes the year only when it differs', () => {
    expect(describeDueDate('2027-01-04', THURSDAY)).toBe('4 Jan 2027')
    expect(describeDueDate('2026-11-05', THURSDAY)).not.toContain('2026')
  })
})

describe('bucketOf', () => {
  it('sorts a date into the section it belongs to', () => {
    expect(bucketOf('2026-10-01', THURSDAY)).toBe('overdue')
    expect(bucketOf('2026-10-28', THURSDAY)).toBe('overdue')
    expect(bucketOf(THURSDAY, THURSDAY)).toBe('today')
    expect(bucketOf('2026-10-30', THURSDAY)).toBe('tomorrow')
    expect(bucketOf('2026-10-31', THURSDAY)).toBe('thisWeek')
    expect(bucketOf('2026-11-04', THURSDAY)).toBe('thisWeek')
    expect(bucketOf('2026-11-05', THURSDAY)).toBe('later')
  })
})

describe('quickDates', () => {
  it('offers today, tomorrow and the next two weeks', () => {
    expect(quickDates(THURSDAY)).toEqual([
      { label: 'Today', iso: '2026-10-29' },
      { label: 'Tomorrow', iso: '2026-10-30' },
      { label: 'In 1 week', iso: '2026-11-05' },
      { label: 'In 2 weeks', iso: '2026-11-12' },
    ])
  })
})

describe('todayIso', () => {
  it('takes the local calendar day, not the UTC one', () => {
    // 23:30 on the 29th in a zone ahead of UTC is still the 29th locally, though 20:30 UTC.
    expect(todayIso(new Date(2026, 9, 29, 23, 30))).toBe('2026-10-29')
    expect(todayIso(new Date(2026, 9, 29, 0, 15))).toBe('2026-10-29')
  })
})
