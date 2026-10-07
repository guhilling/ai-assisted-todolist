import { Suspense, lazy, useEffect, useId, useRef, useState } from 'react'
import { useI18n } from '../i18n/context'

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
 * The field stays a native `input type="date"`, so typing a date and every assistive
 * technology's handling of it keep working. The calendar opens from the button next to it,
 * closes on Escape, on a click outside and once a day is picked, and gives focus back to the
 * button. It is loaded on first use, so the board does not pay for it until it is wanted.
 */
function DueDateField({ value, onChange, min }: Readonly<DueDateFieldProps>) {
  const { messages } = useI18n()
  const inputId = useId()
  const calendarId = useId()
  const [open, setOpen] = useState(false)
  const fieldRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)

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
        setOpen(false)
        toggleRef.current?.focus()
      }
    }

    document.addEventListener('click', closeUnlessInside)
    const field = fieldRef.current
    field?.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('click', closeUnlessInside)
      field?.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div className="add-field date-field" ref={fieldRef}>
      <label htmlFor={inputId}>{messages.dueDate.label}</label>
      <div className="date-field-row">
        <input
          id={inputId}
          required
          type="date"
          min={min}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
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
                setOpen(false)
                toggleRef.current?.focus()
              }}
            />
          </Suspense>
        </div>
      ) : null}
    </div>
  )
}

export default DueDateField
