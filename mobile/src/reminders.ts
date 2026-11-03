import type { BoardTask } from './api'
import { timeOf } from './pickedDates'
import { calendarParts, type Messages } from './web'

/** One local notification: when, and what it says. */
export type Reminder = { at: Date; title: string }

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
  const summaries = countBy(open, (task) => eightOn(task.dueDate)).map(([at, count]) => ({
    at,
    title: messages.reminders.dueToday(count),
  }))
  const timed = countBy(
    open.filter((task) => task.dueTime),
    (task) => dueMoment(task),
  ).map(([at, count]) => ({ at, title: messages.reminders.dueAt(count, timeOf(at)) }))
  // One budget for both, the nearest first: iOS drops what is beyond its 64.
  return [...summaries, ...timed]
    .filter((reminder) => reminder.at.getTime() > now)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, MAX_REMINDERS)
}

/**
 * When a timed task is due (#478). A floating one -- "pills at 08:00" -- at its time on the phone's
 * clock, wherever the phone is when the reminders are scheduled; a zoned one at its one moment,
 * `dueAt`, which the backend works out, so the app needs no time-zone database of its own.
 */
function dueMoment(task: BoardTask): Date | null {
  if (task.timeZone) {
    return task.dueAt ? new Date(task.dueAt) : null
  }
  const { year, month, day } = calendarParts(task.dueDate)
  const [hours, minutes] = (task.dueTime ?? '').split(':').map(Number)
  return new Date(year, month - 1, day, hours, minutes)
}

/** The tasks counted by the moment they remind at: one reminder for each moment, with its count. */
function countBy(tasks: BoardTask[], momentOf: (task: BoardTask) => Date | null): [Date, number][] {
  const counted = new Map<number, number>()
  for (const task of tasks) {
    const moment = momentOf(task)
    if (moment && !Number.isNaN(moment.getTime())) {
      counted.set(moment.getTime(), (counted.get(moment.getTime()) ?? 0) + 1)
    }
  }
  return [...counted.entries()].map(([at, count]) => [new Date(at), count])
}

/** 08:00 on a calendar day, in the phone's time zone. */
function eightOn(iso: string) {
  const { year, month, day } = calendarParts(iso)
  return new Date(year, month - 1, day, HOUR, 0)
}
