import type { BoardTask } from './api'
import { dateOf, isoOf, timeOf } from './pickedDates'
import type { Messages } from './web'

/**
 * One local notification: when, and what it says. A floating one -- the 08:00 summary, a task with
 * a time and no zone -- also says the wall-clock time it stands for, `YYYY-MM-DDTHH:mm`, by which
 * Android's receiver moves it when the phone's time zone changes (#479); a zoned one has none, as
 * its moment is the same everywhere.
 */
export type Reminder = { at: Date; title: string; wallClock?: string }

/**
 * At most this many reminders are scheduled: iOS keeps 64 pending notifications per app and drops
 * the rest, so the nearest days are the ones scheduled, and the next load schedules further ones.
 */
export const MAX_REMINDERS = 60

/** The hour of the reminder, on the phone's clock (#273); a per-user setting is a later story. */
const HOUR = 8

/**
 * The reminders for a board: one at 08:00 on every day with open tasks due that day, saying how
 * many (#273), and one at each moment open tasks with a time are due, saying how many and when
 * (#478). A completed task never reminds, nor one whose state this release does not
 * know (#268) -- a newer backend's state may well be a closed one; an overdue task is the board's
 * to show, and today's reminder is scheduled only until its 08:00 has passed.
 *
 * 08:00, and a floating task's time, are the phone's local time when the reminders are scheduled;
 * following a change of time zone afterwards is #479's.
 */
export function remindersFor(tasks: BoardTask[], now: number, messages: Messages): Reminder[] {
  const open = tasks.filter((task) => task.state !== 'DONE' && !task.unknown?.includes('state'))
  const summaries = countBy(open, (task) => {
    const day = dayDue(task)
    const at = dateOf(day)
    at.setHours(HOUR)
    return { at, time: '', wallClock: `${day}T${String(HOUR).padStart(2, '0')}:00` }
  }).map(({ at, count, wallClock }) => ({ at, title: messages.reminders.dueToday(count), wallClock }))
  const summaryAt = new Set(summaries.map((summary) => summary.at.getTime()))
  const timed = countBy(open.filter((task) => task.dueTime), dueMoment)
    // A task due at 08:00 is what that day's summary says already.
    .filter(({ at }) => !summaryAt.has(at.getTime()))
    .map(({ at, time, count, wallClock }) => ({
      at,
      title: messages.reminders.dueAt(count, time),
      ...(wallClock ? { wallClock } : {}),
    }))
  // One budget for both, the nearest first: iOS drops what is beyond its 64.
  return [...summaries, ...timed]
    .filter((reminder) => reminder.at.getTime() > now)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, MAX_REMINDERS)
}

/**
 * The day a task is due on the phone's calendar, which its 08:00 summary is for: a zoned task's is
 * the day of its moment here, which may not be the day it was set for where it was set.
 */
function dayDue(task: BoardTask): string {
  return task.timeZone && task.dueAt ? isoOf(new Date(task.dueAt)) : task.dueDate
}

/**
 * When a timed task is due (#478), and the time its reminder says. A floating one -- "pills at
 * 08:00" -- at its time on the phone's clock, wherever the phone is when the reminders are
 * scheduled, and worded as the task has it, even on a day that skips that hour; a zoned one at its
 * one moment, `dueAt`, which the backend works out, so the app needs no time-zone database of its
 * own, and worded by the phone's clock.
 */
function dueMoment(task: BoardTask): Moment | null {
  const time = task.dueTime as string
  if (task.timeZone) {
    if (!task.dueAt) {
      return null
    }
    const at = new Date(task.dueAt)
    return { at, time: timeOf(at) }
  }
  const at = dateOf(task.dueDate)
  const [hours, minutes] = time.split(':').map(Number)
  at.setHours(hours, minutes)
  return { at, time, wallClock: `${task.dueDate}T${time}` }
}

/** When a reminder is, what time it says, and, for a floating one, the wall-clock time it stands for. */
type Moment = { at: Date; time: string; wallClock?: string }

/**
 * The tasks counted by the moment they remind at, and what it says: one reminder for each, with
 * its count.
 */
function countBy(tasks: BoardTask[], momentOf: (task: BoardTask) => Moment | null): (Moment & { count: number })[] {
  const counted = new Map<string, Moment & { count: number }>()
  for (const task of tasks) {
    const moment = momentOf(task)
    if (moment && !Number.isNaN(moment.at.getTime())) {
      const key = `${moment.at.getTime()} ${moment.time}`
      const known = counted.get(key)
      counted.set(key, { ...moment, count: (known?.count ?? 0) + 1 })
    }
  }
  return [...counted.values()]
}
