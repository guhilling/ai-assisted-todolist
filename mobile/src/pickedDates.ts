/**
 * The bridge between the backend's ISO dates and times and the platform pickers' `Date`s (#271,
 * #477), which mean a day on the phone's own calendar and a time on its own clock.
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

/** The time the time picker chose, as the API writes it, `HH:mm`, read on the phone's own clock. */
export function timeOf(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}
