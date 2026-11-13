import { Suspense, lazy, useEffect, useId, useRef, useState } from 'react'
import { readTypedDate, typedDate } from '../dates'
import { useReturnFocus } from '../focus'
import { useI18n } from '../i18n/context'
import { hasFinePointer } from '../pointer'

const CalendarPanel = lazy(() => import('./CalendarPanel'))

type DueDateFieldProps = {
  value: string
  onChange: (iso: string) => void
  /** The earliest date allowed. Adding sets today; editing sets nothing, as the backend does. */
  min?: string
}

/**
 * The due date in the add and edit forms: a date field to type into, and a calendar to pick
 * from.
 *
 * On a phone the field is a native `input type="date"`, whose picker suits the phone. On a desktop
 * it is a text field in the language's numeric form (#588): Safari opens a calendar of its own on
 * a click into a date field, and Firefox shows its own button, which no CSS hides, so TaskFest's
 * calendar would be the second picker. On a phone the button is hidden by the stylesheet, which
 * leaves the phone's own picker the only one. The calendar opens from the button next to it,
 * closes on Escape, on a click outside and once a day is picked, and gives focus back to the
 * button. It is loaded on first use, so the board does not pay for it until it is wanted.
 */
function DueDateField({ value, onChange, min }: Readonly<DueDateFieldProps>) {
  const { messages, locale } = useI18n()
  const [desktop] = useState(hasFinePointer)
  const inputId = useId()
  const calendarId = useId()
  const [open, setOpen] = useState(false)
  const fieldRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  // Focus goes back to the button only once the calendar has gone (#256, focus.ts): after a pick
  // or Escape, not after a click elsewhere.
  const returnFocus = useReturnFocus(open, toggleRef)

  /** Closes the calendar, and has the button take focus once it is gone. */
  const closeToButton = () => {
    returnFocus()
    setOpen(false)
  }

  useEffect(() => {
    if (!open) {
      return
    }

    const closeUnlessInside = (event: MouseEvent) => {
      if (!fieldRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    // Escape closes the calendar and nothing else: the forms treat Escape as cancel, and one key
    // press should not throw away the whole edit when it meant to dismiss a popover.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        returnFocus()
        setOpen(false)
      }
    }

    document.addEventListener('click', closeUnlessInside)
    const field = fieldRef.current
    field?.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('click', closeUnlessInside)
      field?.removeEventListener('keydown', closeOnEscape)
    }
  }, [open, returnFocus])

  return (
    <div className="add-field date-field" ref={fieldRef}>
      <label htmlFor={inputId}>{messages.dueDate.label}</label>
      <div className="date-field-row">
        {desktop ? (
          <TypedDate id={inputId} value={value} min={min} locale={locale} onChange={onChange} />
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
 * date field's own checks would.
 */
function TypedDate({
  id,
  value,
  min,
  locale,
  onChange,
}: Readonly<{ id: string; value: string; min?: string; locale: string; onChange: (iso: string) => void }>) {
  const { messages } = useI18n()
  const [text, setText] = useState(() => typedDate(value, locale))
  const input = useRef<HTMLInputElement>(null)

  // A date set from elsewhere -- a shortcut, the calendar -- is shown as the language writes it,
  // unless it is the one typed already.
  const [shown, setShown] = useState(value)
  if (value !== shown) {
    setShown(value)
    if (readTypedDate(text, locale) !== value) {
      setText(typedDate(value, locale))
    }
  }

  const problem = (typed: string) => {
    const iso = readTypedDate(typed, locale)
    if (iso === null) {
      return messages.dueDate.invalid(typedDate(value || min || '', locale) || typed)
    }
    return min !== undefined && iso < min ? messages.dueDate.tooEarly : ''
  }

  useEffect(() => {
    input.current?.setCustomValidity(problem(text))
  })

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
        event.target.setCustomValidity(problem(typed))
        const iso = readTypedDate(typed, locale)
        if (iso !== null && (min === undefined || iso >= min)) {
          onChange(iso)
        }
      }}
    />
  )
}

export default DueDateField
