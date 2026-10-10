import type { BoardTask } from './api'
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
