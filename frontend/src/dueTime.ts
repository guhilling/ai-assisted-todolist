import type { TaskResponse } from './generated/types'
import { shortWeekday, todayIso, type DateWords } from './dates'

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
  const moment = task.dueAt ? new Date(task.dueAt) : null
  // No moment, or one this device cannot read: the time there is all that can be said.
  if (!moment || Number.isNaN(moment.getTime())) {
    return `${task.dueTime} (${zone})`
  }
  const here = clock(moment)
  if (here.date === task.dueDate) {
    return here.time === task.dueTime ? task.dueTime : words.elsewhere(task.dueTime, zone, here.time)
  }
  return words.elsewhere(
    `${shortWeekday(task.dueDate, locale)} ${task.dueTime}`,
    zone,
    `${shortWeekday(here.date, locale)} ${here.time}`,
  )
}

/** A day and a time on a clock, as the API writes them: `yyyy-mm-dd` and `HH:mm`. */
export type LocalTime = { date: string; time: string }

/** A moment on this device's own clock. */
function localTime(instant: Date): LocalTime {
  const pad = (value: number) => String(value).padStart(2, '0')
  return { date: todayIso(instant), time: `${pad(instant.getHours())}:${pad(instant.getMinutes())}` }
}

/**
 * A time zone as people name it: its city, "New York" for `America/New_York`, and UTC or GMT as
 * they are. The IANA name's last part is the city, in English in every language.
 */
export function zoneName(zone: string) {
  return zone.slice(zone.lastIndexOf('/') + 1).replaceAll('_', ' ')
}

/**
 * The zone this browser is in, which a time tied to a zone starts from (#476): UTC when the browser
 * names a fixed offset, such as `Etc/GMT-2` or `GMT+1`, which the backend refuses.
 */
export function browserZone() {
  return offerable(Intl.DateTimeFormat().resolvedOptions().timeZone)
}

/**
 * `zone` if a task can be tied to it, else UTC: a region's zone, `Area/City`, never a fixed offset
 * (`Etc/…`, `GMT+1`), which the backend refuses. Not checked against a list: lists and devices name
 * some zones differently, `Asia/Calcutta` and `Asia/Kolkata`, and the backend takes both.
 */
export function offerable(zone: string | null) {
  return zone === 'UTC' || (zone?.includes('/') && !zone.startsWith('Etc/')) ? zone : 'UTC'
}

/**
 * The zones a task can be tied to, as the zone picker offers them (#476): the browser's own list,
 * without the `Etc/` zones, which are fixed offsets the backend refuses, and with `UTC`, which it
 * takes. `current` is added if the list lacks it, so a task's zone is always shown as it is.
 */
export function timeZones(current: string | null = null) {
  // Safari before 15.4 lacks the list; then the task's zone and UTC are all there is to offer.
  const known = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC']
  // Browsers list UTC under no name, or as an Etc/ alias; it is offered by its own.
  const zones = [...known.filter((zone) => zone !== 'UTC' && offerable(zone) === zone), 'UTC']
  return (current && !zones.includes(current) ? [...zones, current] : zones).sort()
}
