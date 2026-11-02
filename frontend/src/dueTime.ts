import type { TaskResponse } from './generated/types'
import type { DateWords } from './dates'

/**
 * How a task's due time reads on a row (#475): the time alone, or, for a task tied to a time zone
 * that is due at another time here, the time there, the zone, and the time here.
 *
 * Apart from `dates.ts` because a due date stays a date without a clock there. No time-zone
 * database is needed: the time and day there are the task's own, and the time and day here come
 * from `dueAt`, the moment the backend worked out, read by the device's clock.
 */
export function describeDueTime(
  task: Pick<TaskResponse, 'dueDate' | 'dueTime' | 'timeZone' | 'dueAt'>,
  words: DateWords,
  locale: string,
  clock: (instant: Date) => LocalTime = localTime,
): string | null {
  if (!task.dueTime) {
    return null
  }
  if (!task.timeZone) {
    return task.dueTime
  }
  const zone = zoneName(task.timeZone)
  if (!task.dueAt) {
    return `${task.dueTime} (${zone})`
  }
  const here = clock(new Date(task.dueAt))
  if (here.date === task.dueDate) {
    return here.time === task.dueTime ? task.dueTime : words.elsewhere(task.dueTime, zone, here.time)
  }
  return words.elsewhere(
    `${weekday(task.dueDate, locale)} ${task.dueTime}`,
    zone,
    `${weekday(here.date, locale)} ${here.time}`,
  )
}

/** A day and a time on a clock, as the API writes them: `yyyy-mm-dd` and `HH:mm`. */
export type LocalTime = { date: string; time: string }

/** A moment on this device's own clock. */
function localTime(instant: Date): LocalTime {
  const pad = (value: number) => String(value).padStart(2, '0')
  return {
    date: `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`,
    time: `${pad(instant.getHours())}:${pad(instant.getMinutes())}`,
  }
}

/** A date's short weekday, "Tue" or "Di.", read at UTC midnight so no zone shifts the day. */
function weekday(iso: string, locale: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' })
}

/**
 * A time zone as people name it: its city, "New York" for `America/New_York`, and UTC or GMT as
 * they are. The IANA name's last part is the city, in English in every language.
 */
export function zoneName(zone: string) {
  return zone.slice(zone.lastIndexOf('/') + 1).replaceAll('_', ' ')
}
