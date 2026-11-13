import { Suspense, lazy, useEffect, useId, useRef, useState } from 'react'
import { readTypedDate, typedDate } from '../dates'
import { useI18n } from '../i18n/context'
import { onDesktop } from '../pointer'
import { usePopover } from '../popover'

const CalendarPanel = lazy(() => import('./CalendarPanel'))

type DueDateFieldProps = {
  value: string
  onChange: (iso: string) => void
  /** The earliest date allowed. Adding sets today; editing sets nothing, as the backend does. */
  min?: string
  /**
   * Counts the dates picked from outside the field, a shortcut's included (#588): a pick shows the
   * date picked even when the form held it already, replacing whatever was half typed.
   */
  picked?: number
}

/**
 * The due date in the add and edit forms: a date field to type into, and a calendar to pick
 * from.
 *
 * On a phone the field is a native `input type="date"`, whose picker suits the phone, and the
 * calendar button is hidden. On a desktop it is a text field in the language's numeric form
 * (#588): Safari opens a calendar of its own on a click into a date field, and Firefox shows its
 * own button, which no CSS hides, so TaskFest's calendar would be the second picker. The calendar
 * opens from the button next to it, closes on Escape, on a click outside and once a day is picked,
 * and gives focus back to the button (`popover.ts`). It is loaded on first use, so the board does
 * not pay for it until it is wanted.
 */
function DueDateField({ value, onChange, min, picked = 0 }: Readonly<DueDateFieldProps>) {
  const { messages, locale } = useI18n()
  const [desktop] = useState(onDesktop)
  const inputId = useId()
  const calendarId = useId()
  const fieldRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const { open, setOpen, closeToButton } = usePopover(fieldRef, toggleRef)
  // A day picked from the calendar counts as a pick, as a shortcut's does.
  const [calendarPicks, setCalendarPicks] = useState(0)

  return (
    <div className={`add-field date-field${desktop ? '' : ' date-field--native'}`} ref={fieldRef}>
      <label htmlFor={inputId}>{messages.dueDate.label}</label>
      <div className="date-field-row">
        {desktop ? (
          <TypedDate
            id={inputId}
            value={value}
            min={min}
            locale={locale}
            picked={picked + calendarPicks}
            onChange={onChange}
          />
        ) : (
          <input
            id={inputId}
            required
            type="date"
            min={min}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
        <button
          ref={toggleRef}
          type="button"
          className="date-field-toggle"
          aria-label={messages.dueDate.calendar}
          aria-expanded={open}
          aria-controls={open ? calendarId : undefined}
          onClick={() => setOpen((current) => !current)}
        >
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <rect x="3" y="4.5" width="14" height="12.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M3 8.5h14M7 2.5v4M13 2.5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {open ? (
        <div className="date-field-popover" id={calendarId}>
          <Suspense fallback={<p className="date-field-loading">{messages.dueDate.loadingCalendar}</p>}>
            <CalendarPanel
              value={value}
              min={min}
              onPick={(iso) => {
                onChange(iso)
                setCalendarPicks((count) => count + 1)
                closeToButton()
              }}
            />
          </Suspense>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The desktop's date field (#588): the date as the language writes it, read as it is typed. What
 * cannot be read, or lies before `min`, keeps the form from being sent and says why, as a native
 * date field's own checks would. A date set from elsewhere, a pick or a language switched to, is
 * written anew.
 */
function TypedDate({
  id,
  value,
  min,
  locale,
  picked,
  onChange,
}: Readonly<{
  id: string
  value: string
  min?: string
  locale: string
  picked: number
  onChange: (iso: string) => void
}>) {
  const { messages } = useI18n()
  const [text, setText] = useState(() => typedDate(value, locale))
  const input = useRef<HTMLInputElement>(null)

  // What the text was last written for: a new date, a new pick or a new language writes it anew,
  // unless a new date is the one typed already.
  const [writtenFor, setWrittenFor] = useState({ value, locale, picked })
  if (writtenFor.value !== value || writtenFor.locale !== locale || writtenFor.picked !== picked) {
    const typedAs = readTypedDate(text, writtenFor.locale)
    setWrittenFor({ value, locale, picked })
    if (writtenFor.picked !== picked || writtenFor.locale !== locale || typedAs !== value) {
      setText(typedDate(value, locale))
    }
  }

  // The one place the field's validity is set, whatever changed it.
  useEffect(() => {
    const iso = readTypedDate(text, locale)
    let problem = ''
    if (iso === null) {
      problem = messages.dueDate.invalid(typedDate(value || min || '', locale) || text)
    } else if (min !== undefined && iso < min) {
      problem = messages.dueDate.tooEarly
    }
    input.current?.setCustomValidity(problem)
  }, [text, value, min, locale, messages])

  return (
    <input
      ref={input}
      id={id}
      required
      type="text"
      autoComplete="off"
      placeholder={messages.dueDate.format}
      value={text}
      onChange={(event) => {
        const typed = event.target.value
        setText(typed)
        const iso = readTypedDate(typed, locale)
        if (iso !== null && (min === undefined || iso >= min)) {
          onChange(iso)
        }
      }}
    />
  )
}

export default DueDateField
