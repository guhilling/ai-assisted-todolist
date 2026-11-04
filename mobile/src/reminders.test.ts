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
      { at: at8(2026, 10, 11), title: '2 tasks due today' },
      { at: at8(2026, 10, 14), title: '1 task due today' },
    ])
  })

  it('reminds today too, until 08:00 has passed', () => {
    const tasks = [task('2026-10-10')]

    expect(remindersFor(tasks, EARLY, catalogues.en)).toEqual([{ at: at8(2026, 10, 10), title: '1 task due today' }])
    expect(remindersFor(tasks, LATE, catalogues.en)).toEqual([])
  })

  it('counts only open tasks: a completed one never reminds', () => {
    const tasks = [task('2026-10-11', 'DONE'), task('2026-10-12', 'DONE'), task('2026-10-12', 'WORKING')]

    expect(remindersFor(tasks, EARLY, catalogues.en)).toEqual([{ at: at8(2026, 10, 12), title: '1 task due today' }])
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
      { at: at8(2026, 10, 11), title: '1 task due today' },
      { at: new Date(2026, 9, 11, 10, 30), title: 'A task is due at 10:30' },
    ])
  })

  it('reminds of a zoned task at its one moment, worded by the phone\'s clock', () => {
    const dueAt = '2026-10-11T08:00:00Z'
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
      { at: at8(2026, 10, 11), title: '1 task due today' },
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
