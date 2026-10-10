/**
 * The bridge between the backend's ISO dates and the platform picker's `Date`s (#271), which mean a
 * day on the phone's own calendar.
 */

/** An ISO date as midnight on the phone's own calendar, which is the day the picker shows. */
export function dateOf(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** The day the picker chose, as an ISO date, read on the phone's own calendar. */
export function isoOf(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
