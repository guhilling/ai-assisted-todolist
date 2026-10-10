import type { BoardTask } from './api'
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
 * The due-day reminders for a board (#273): one at 08:00 on every day with open tasks due that
 * day, saying how many. A completed task never reminds, nor one whose state this release does not
 * know (#268) -- a newer backend's state may well be a closed one; an overdue task is the board's
 * to show, and today's reminder is scheduled only until its 08:00 has passed.
 *
 * 08:00 is the phone's local time when the reminders are scheduled; following a change of time
 * zone afterwards is #290's.
 */
export function remindersFor(tasks: BoardTask[], now: number, messages: Messages): Reminder[] {
  const due = new Map<string, number>()
  for (const task of tasks) {
    if (task.state !== 'DONE' && !task.unknown?.includes('state')) {
      due.set(task.dueDate, (due.get(task.dueDate) ?? 0) + 1)
    }
  }
  return [...due.entries()]
    .map(([day, count]) => ({ at: eightOn(day), title: messages.reminders.dueToday(count) }))
    .filter((reminder) => reminder.at.getTime() > now)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, MAX_REMINDERS)
}

/** 08:00 on a calendar day, in the phone's time zone. */
function eightOn(iso: string) {
  const { year, month, day } = calendarParts(iso)
  return new Date(year, month - 1, day, HOUR, 0)
}
