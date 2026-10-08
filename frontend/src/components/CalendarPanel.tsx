import { DayPicker } from 'react-day-picker'
import 'react-day-picker/style.css'
// One module per locale rather than the barrel, which brings in all of react-day-picker's ~95.
import { de } from 'react-day-picker/locale/de'
import { useI18n } from '../i18n/context'
import type { Language } from '../i18n/language'

type CalendarPanelProps = {
  /** The selected day, as the ISO date the forms keep. */
  value: string
  /** The earliest day that may be picked, if any. */
  min?: string
  onPick: (iso: string) => void
}

/**
 * react-day-picker's own locale for each language the app speaks (#203). English keeps the
 * library's default, as before: its day labels are what the tests and screen readers know.
 */
const dayPickerLocales: Record<Language, typeof de | undefined> = { en: undefined, de }

/** An ISO date as a local midnight. `new Date('2026-10-05')` would be UTC midnight instead. */
function fromIso(iso: string) {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** A local date as ISO. `toISOString` would convert to UTC and, east of Greenwich, a day back. */
function toIso(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * A month calendar for picking a due date, from react-day-picker.
 *
 * It is a module of its own so that `DueDateField` can load it lazily: the library is about
 * 20 kB gzipped, and the board's first load stays as fast as before because nothing fetches
 * it until someone opens a calendar. The weeks start on Monday, and the colours come from the
 * board's tokens through the library's CSS variables (`App.css`, `.date-field .rdp-root`).
 */
function CalendarPanel({ value, min, onPick }: Readonly<CalendarPanelProps>) {
  const { language } = useI18n()
  const selected = value ? fromIso(value) : undefined

  return (
    <DayPicker
      mode="single"
      required
      autoFocus
      weekStartsOn={1}
      // Month and weekday names, and the day buttons' labels, in the language the app speaks.
      locale={dayPickerLocales[language]}
      selected={selected}
      defaultMonth={selected}
      disabled={min ? { before: fromIso(min) } : undefined}
      onSelect={(date) => onPick(toIso(date))}
    />
  )
}

export default CalendarPanel
