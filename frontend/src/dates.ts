/**
 * Due-date arithmetic and the words the board puts on screen.
 *
 * Every function takes today as an ISO `yyyy-mm-dd` string rather than reading the clock, so
 * the tests need no clock faking and a render is a pure function of its inputs. Dates are
 * handled as ISO strings throughout and only turned into `Date` for UTC-anchored arithmetic:
 * the API speaks `LocalDate`, which has no time and no zone, and constructing a local `Date`
 * from `yyyy-mm-dd` shifts the day backwards west of UTC.
 */

import { localeOf } from './i18n/language'
import { en, type Messages } from './i18n/messages'

/** Which group of the board a task belongs to, derived from its due date alone. */
export type DueBucket = 'overdue' | 'today' | 'tomorrow' | 'thisWeek' | 'later'

/** A quick-set option offered beside the date field. */
export type QuickDate = {
  label: string
  iso: string
}

/**
 * Pinned rather than left to the environment's default locale, so the same date renders the
 * same string on a German laptop, a US CI runner and in jsdom. Since #203 the caller passes the
 * locale of the language the app speaks; this is the default, English's.
 */
const DISPLAY_LOCALE = localeOf('en')

/** The words a due date is described with, in the language the app speaks: `i18n/messages.ts`. */
export type DateWords = Messages['dates']

const MILLISECONDS_PER_DAY = 86_400_000

/** Anchors an ISO date at UTC midnight, where day arithmetic cannot be bitten by DST. */
function atUtcMidnight(iso: string) {
  const { year, month, day } = calendarParts(iso)
  return new Date(Date.UTC(year, month - 1, day))
}

/**
 * A `yyyy-mm-dd` date's year, month (1-12) and day: the one place it is taken apart, for the
 * website's arithmetic above and the app's 08:00 on the day (#273).
 */
export function calendarParts(iso: string) {
  const [year, month, day] = iso.split('-').map(Number)
  return { year, month, day }
}

/** Formats a UTC-anchored date back to `yyyy-mm-dd`. */
function toIso(date: Date) {
  return date.toISOString().slice(0, 10)
}

/** Today in the browser's own timezone, as the API's `yyyy-mm-dd`. */
export function todayIso(now: Date = new Date()) {
  const local = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return toIso(new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate())))
}

/** Whole days from `fromIso` to `toIso`, negative when `toIso` is earlier. */
export function daysBetween(fromIso: string, toIsoDate: string) {
  return Math.round((atUtcMidnight(toIsoDate).getTime() - atUtcMidnight(fromIso).getTime()) / MILLISECONDS_PER_DAY)
}

/** `iso` shifted by `days`, which may be negative. */
export function addDays(iso: string, days: number) {
  return toIso(new Date(atUtcMidnight(iso).getTime() + days * MILLISECONDS_PER_DAY))
}

/**
 * How a due date should read on a task row.
 *
 * Relative wording for the days people actually think in, a weekday name for the rest of
 * this week, and a date once it is far enough away that "in 9 days" stops meaning anything.
 * Overdue dates say how late they are, because "3 days ago" is the thing worth noticing.
 */
export function describeDueDate(iso: string, today: string, words: DateWords = en.dates, locale = DISPLAY_LOCALE) {
  const offset = daysBetween(today, iso)

  if (offset === 0) {
    return words.today
  }
  if (offset === 1) {
    return words.tomorrow
  }
  if (offset === -1) {
    return words.yesterday
  }
  if (offset < -1) {
    return words.daysAgo(-offset)
  }
  if (offset < 7) {
    return atUtcMidnight(iso).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' })
  }

  const sameYear = iso.slice(0, 4) === today.slice(0, 4)
  return atUtcMidnight(iso).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** Which section of the board a due date belongs in. */
export function bucketOf(iso: string, today: string): DueBucket {
  const offset = daysBetween(today, iso)

  if (offset < 0) {
    return 'overdue'
  }
  if (offset === 0) {
    return 'today'
  }
  if (offset === 1) {
    return 'tomorrow'
  }
  return offset < 7 ? 'thisWeek' : 'later'
}

/**
 * The defaults offered beside the date field.
 *
 * These exist because typing a date is the slowest part of adding a task, and almost every
 * task is due in one of these four places.
 */
export function quickDates(today: string, words: DateWords = en.dates): QuickDate[] {
  return [
    { label: words.today, iso: today },
    { label: words.tomorrow, iso: addDays(today, 1) },
    { label: words.inWeeks(1), iso: addDays(today, 7) },
    { label: words.inWeeks(2), iso: addDays(today, 14) },
  ]
}
