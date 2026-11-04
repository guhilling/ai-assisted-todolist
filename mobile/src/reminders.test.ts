import type { BoardTask } from './api'
import { timeOf } from './pickedDates'
import { MAX_REMINDERS, remindersFor } from './reminders'
import { catalogues } from './web'

/** 10 October 2026, 07:00 on the phone's clock. */
const EARLY = new Date(2026, 9, 10, 7, 0).getTime()
/** The same day, 09:00: today's 08:00 has passed. */
const LATE = new Date(2026, 9, 10, 9, 0).getTime()

let next = 1
function task(dueDate: string, state: BoardTask['state'] = 'TODO'): BoardTask {
  return { id: next++, description: `Task ${next}`, dueDate, importance: 'MEDIUM', state }
}

const at8 = (year: number, month: number, day: number) => new Date(year, month - 1, day, 8, 0)

describe('the due-day reminders (#273)', () => {
  it('reminds once at 08:00 on each day with open tasks due, saying how many', () => {
    const tasks = [task('2026-10-11'), task('2026-10-11'), task('2026-10-14')]

    expect(remindersFor(tasks, EARLY, catalogues.en)).toEqual([
      { at: at8(2026, 10, 11), title: '2 tasks due today', wallClock: '2026-10-11T08:00' },
      { at: at8(2026, 10, 14), title: '1 task due today', wallClock: '2026-10-14T08:00' },
    ])
  })

  it('reminds today too, until 08:00 has passed', () => {
    const tasks = [task('2026-10-10')]

    expect(remindersFor(tasks, EARLY, catalogues.en)).toEqual([{ at: at8(2026, 10, 10), title: '1 task due today', wallClock: '2026-10-10T08:00' }])
    expect(remindersFor(tasks, LATE, catalogues.en)).toEqual([])
  })

  it('counts only open tasks: a completed one never reminds', () => {
    const tasks = [task('2026-10-11', 'DONE'), task('2026-10-12', 'DONE'), task('2026-10-12', 'WORKING')]

    expect(remindersFor(tasks, EARLY, catalogues.en)).toEqual([{ at: at8(2026, 10, 12), title: '1 task due today', wallClock: '2026-10-12T08:00' }])
  })

  it('never reminds of a task whose state this release does not know: it may be closed', () => {
    const closed: BoardTask = { ...task('2026-10-11'), unknown: ['state'] }

    expect(remindersFor([closed], EARLY, catalogues.en)).toEqual([])
  })

  it('leaves overdue tasks to the board', () => {
    expect(remindersFor([task('2026-10-01')], EARLY, catalogues.en)).toEqual([])
  })

  it('never schedules more than iOS keeps, the nearest days first', () => {
    const tasks = Array.from({ length: 80 }, (_, day) => task(`2026-11-${String((day % 30) + 1).padStart(2, '0')}`))
      .concat(Array.from({ length: 50 }, (_, day) => task(`2027-01-${String((day % 31) + 1).padStart(2, '0')}`)))

    const reminders = remindersFor(tasks, EARLY, catalogues.en)

    expect(reminders).toHaveLength(MAX_REMINDERS)
    expect(MAX_REMINDERS).toBeLessThanOrEqual(64)
    expect(reminders[0].at).toEqual(at8(2026, 11, 1))
    expect(reminders.map((reminder) => reminder.at.getTime())).toEqual(
      [...reminders].map((reminder) => reminder.at.getTime()).sort((a, b) => a - b),
    )
  })

  it('speaks German', () => {
    const tasks = [task('2026-10-11'), task('2026-10-11'), task('2026-10-12')]

    expect(remindersFor(tasks, EARLY, catalogues.de).map((reminder) => reminder.title)).toEqual([
      '2 Aufgaben heute fällig',
      '1 Aufgabe heute fällig',
    ])
  })
})

describe('the reminders at a task\'s due time (#478)', () => {
  /** A task with a time: floating without a zone, tied to one with it and the moment it names. */
  function timed(dueDate: string, dueTime: string, zone?: { timeZone: string; dueAt: string }): BoardTask {
    return { ...task(dueDate), dueTime, ...(zone ?? {}) }
  }


  it('reminds of a floating task at its time on the phone\'s clock, and still counts it at 08:00', () => {
    const reminders = remindersFor([timed('2026-10-11', '10:30')], EARLY, catalogues.en)

    expect(reminders).toEqual([
      { at: at8(2026, 10, 11), title: '1 task due today', wallClock: '2026-10-11T08:00' },
      { at: new Date(2026, 9, 11, 10, 30), title: 'A task is due at 10:30', wallClock: '2026-10-11T10:30' },
    ])
  })

  it('reminds of a zoned task at its one moment, worded by the phone\'s clock', () => {
    // 10:00 on this phone, wherever it runs: at 08:00 the summary would stand for it.
    const dueAt = new Date(2026, 9, 11, 10, 0).toISOString()
    const reminders = remindersFor(
      [timed('2026-10-11', '10:00', { timeZone: 'Europe/Berlin', dueAt })],
      EARLY,
      catalogues.en,
    )

    expect(reminders).toContainEqual({ at: new Date(dueAt), title: `A task is due at ${timeOf(new Date(dueAt))}` })
  })

  it('reminds once of tasks due at the same moment, saying how many', () => {
    const tasks = [timed('2026-10-11', '10:30'), timed('2026-10-11', '10:30'), timed('2026-10-11', '11:00')]

    expect(remindersFor(tasks, EARLY, catalogues.en).map((reminder) => reminder.title)).toEqual([
      '3 tasks due today',
      '2 tasks are due at 10:30',
      'A task is due at 11:00',
    ])
  })

  it('reminds of no completed timed task, nor one whose time has passed', () => {
    const tasks = [{ ...timed('2026-10-10', '12:00'), state: 'DONE' as const }, timed('2026-10-10', '08:30')]

    expect(remindersFor(tasks, LATE, catalogues.en)).toEqual([])
  })

  it('shares the budget with the summaries, keeping the nearest of both', () => {
    // Three timed tasks a day for 30 days: 90 timed reminders and 30 summaries to choose from.
    const tasks = Array.from({ length: 90 }, (_, n) =>
      timed(`2026-11-${String((n % 30) + 1).padStart(2, '0')}`, `1${Math.floor(n / 30)}:00`),
    )

    const reminders = remindersFor(tasks, EARLY, catalogues.en)

    expect(reminders).toHaveLength(MAX_REMINDERS)
    // The first 15 days whole: each one's 08:00 summary and its 10:00, 11:00 and 12:00.
    expect(reminders.filter((reminder) => reminder.title.endsWith('due today'))).toHaveLength(15)
    expect(reminders.at(-1)?.at).toEqual(new Date(2026, 10, 15, 12, 0))
  })

  it('puts a zoned task\'s summary on the day it is due on the phone\'s calendar', () => {
    // Due on the 11th where it was set, which is the evening of the 10th on this phone.
    const dueAt = new Date(2026, 9, 10, 18, 0).toISOString()
    const reminders = remindersFor([timed('2026-10-11', '01:00', { timeZone: 'Asia/Tokyo', dueAt })], EARLY, catalogues.en)

    expect(reminders).toEqual([
      { at: at8(2026, 10, 10), title: '1 task due today' },
      { at: new Date(dueAt), title: 'A task is due at 18:00' },
    ])
  })

  it('reminds once at 08:00 of a task due at 08:00: the summary already says so', () => {
    expect(remindersFor([timed('2026-10-11', '08:00')], EARLY, catalogues.en)).toEqual([
      { at: at8(2026, 10, 11), title: '1 task due today', wallClock: '2026-10-11T08:00' },
    ])
  })

  it('speaks German', () => {
    const tasks = [timed('2026-10-11', '10:30'), timed('2026-10-11', '10:30'), timed('2026-10-11', '11:00')]

    expect(remindersFor(tasks, EARLY, catalogues.de).map((reminder) => reminder.title).slice(1)).toEqual([
      '2 Aufgaben sind um 10:30 fällig',
      'Eine Aufgabe ist um 11:00 fällig',
    ])
  })
})

describe('the reminders that follow a change of time zone (#479)', () => {
  it('give the floating ones their wall-clock time, the summary\'s included, and a zoned one none', () => {
    const dueAt = new Date(2026, 9, 11, 10, 0).toISOString()
    const tasks = [
      { ...task('2026-10-11'), dueTime: '09:30' },
      { ...task('2026-10-11'), dueTime: '10:00', timeZone: 'Asia/Tokyo', dueAt },
    ]

    expect(remindersFor(tasks, EARLY, catalogues.en)).toEqual([
      // The summary counts the zoned task too, so it stays (see the review's tests below).
      { at: at8(2026, 10, 11), title: '2 tasks due today' },
      { at: new Date(2026, 9, 11, 9, 30), title: 'A task is due at 09:30', wallClock: '2026-10-11T09:30' },
      { at: new Date(dueAt), title: 'A task is due at 10:00' },
    ])
  })
})

describe('which reminders may move with the time zone (#479, review)', () => {
  /** A task tied to a zone, due at a moment that is this phone's local time given. */
  const zoned = (dueDate: string, local: Date): BoardTask => ({
    ...task(dueDate),
    dueTime: '10:00',
    timeZone: 'Asia/Tokyo',
    dueAt: local.toISOString(),
  })

  it('keeps a summary that counts a zoned task where it is: its day is the zone\'s, not the clock\'s', () => {
    const reminders = remindersFor(
      [{ ...task('2026-10-11'), dueTime: '09:30' }, zoned('2026-10-11', new Date(2026, 9, 11, 10, 0))],
      EARLY,
      catalogues.en,
    )

    expect(reminders[0]).toEqual({ at: at8(2026, 10, 11), title: '2 tasks due today' })
  })

  it('keeps a zoned task\'s reminder at 08:00 beside the summary, which may move without it', () => {
    const reminders = remindersFor([zoned('2026-10-11', at8(2026, 10, 11))], EARLY, catalogues.en)

    expect(reminders).toEqual([
      { at: at8(2026, 10, 11), title: '1 task due today' },
      { at: at8(2026, 10, 11), title: 'A task is due at 08:00' },
    ])
  })

  it('never merges a floating and a zoned task due at the same moment', () => {
    const tasks = [{ ...task('2026-10-11'), dueTime: '10:00' }, zoned('2026-10-11', new Date(2026, 9, 11, 10, 0))]
    const timed = remindersFor(tasks, EARLY, catalogues.en).filter((reminder) => reminder.title.includes('due at'))

    expect(timed).toEqual([
      { at: new Date(2026, 9, 11, 10, 0), title: 'A task is due at 10:00', wallClock: '2026-10-11T10:00' },
      { at: new Date(2026, 9, 11, 10, 0), title: 'A task is due at 10:00' },
    ])
  })
})
