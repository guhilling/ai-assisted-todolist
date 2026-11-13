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
 * The weekday beside "Today" and "Tomorrow" (#337), which do not say it -- on holiday, which day
 * today is is not always obvious. Null for any other day: its description is a weekday or a date
 * already, and "Yesterday" belongs to an overdue task, where the day matters less than that it is late.
 */
export function weekdayBeside(iso: string, today: string, locale = DISPLAY_LOCALE): string | null {
  const offset = daysBetween(today, iso)
  if (offset !== 0 && offset !== 1) {
    return null
  }
  return atUtcMidnight(iso).toLocaleDateString(locale, { weekday: 'long', timeZone: 'UTC' })
}

/**
 * A due date as one text with its weekday where "Today" or "Tomorrow" leaves it out (#337) --
 * "Today · Saturday" -- for a row with no room for two items, as in the app.
 */
export function describeDueDateWithWeekday(iso: string, today: string, words: DateWords = en.dates, locale = DISPLAY_LOCALE) {
  const described = describeDueDate(iso, today, words, locale)
  const weekday = weekdayBeside(iso, today, locale)
  return weekday ? words.withWeekday(described, weekday) : described
}

/** The weekday beside a board section's heading: Today's and Tomorrow's, none for any other (#337). */
export function sectionWeekday(bucket: DueBucket, today: string, locale = DISPLAY_LOCALE): string | null {
  if (bucket === 'today') {
    return weekdayBeside(today, today, locale)
  }
  return bucket === 'tomorrow' ? weekdayBeside(addDays(today, 1), today, locale) : null
}

/** A date's short weekday, "Tue" or "Di", read at UTC midnight so no time zone shifts the day. */
export function shortWeekday(iso: string, locale = DISPLAY_LOCALE) {
  return atUtcMidnight(iso).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' })
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
    return shortWeekday(iso, locale)
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

/**
 * Each locale's numeric date form, once worked out: `en-GB` is `14/11/2026`, `de-DE` `14.11.2026`,
 * read from `Intl` rather than kept by hand.
 */
const numericForms = new Map<string, { order: Intl.DateTimeFormatPartTypes[]; separator: string }>()

/**
 * The order and separator a locale writes a numeric date in, found by formatting a fixed date with
 * `Intl`, for reading a typed date in that order.
 *
 * Kept per locale in `numericForms`, because the date field reads every keystroke.
 */
function numericForm(locale: string) {
  const known = numericForms.get(locale)
  if (known) {
    return known
  }
  const parts = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
    .formatToParts(new Date(Date.UTC(2026, 10, 14)))
  const order = parts.filter((part) => part.type !== 'literal').map((part) => part.type)
  const separator = parts.find((part) => part.type === 'literal')?.value ?? '/'
  const form = { order, separator }
  numericForms.set(locale, form)
  return form
}

/**
 * A due date as the desktop's date field shows it (#588): in the language's numeric form, where a
 * browser's own date field would open a picker of its own beside TaskFest's calendar.
 */
export function typedDate(iso: string, locale = DISPLAY_LOCALE) {
  if (iso === '') {
    return ''
  }
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
    .format(atUtcMidnight(iso))
}

/**
 * Reads a date typed into that field: the language's numeric form, with or without leading zeros,
 * or an ISO date. Null for anything else -- incomplete, a two-digit year, another order, or a day
 * the calendar does not have.
 */
export function readTypedDate(text: string, locale = DISPLAY_LOCALE): string | null {
  const typed = text.trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typed)
  let year: number
  let month: number
  let day: number
  if (iso) {
    ;[year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  } else {
    const { order, separator } = numericForm(locale)
    const pieces = typed.split(separator)
    if (pieces.length !== 3 || pieces.some((piece) => !/^\d+$/.test(piece))) {
      return null
    }
    const value = (type: string) => Number(pieces[order.indexOf(type as Intl.DateTimeFormatPartTypes)])
    const yearPiece = pieces[order.indexOf('year')]
    if (yearPiece.length !== 4) {
      return null
    }
    ;[year, month, day] = [value('year'), value('month'), value('day')]
  }
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
