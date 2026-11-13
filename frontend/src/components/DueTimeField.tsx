import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { browserZone, timeZones } from '../dueTime'
import { useI18n } from '../i18n/context'
import { onDesktop } from '../pointer'
import { usePopover } from '../popover'

/** The times the desktop's list offers (#588): every quarter of an hour, 00:00 to 23:45. */
const LISTED_TIMES = Array.from({ length: 96 }, (_, quarter) =>
  `${String(Math.floor(quarter / 4)).padStart(2, '0')}:${String((quarter % 4) * 15).padStart(2, '0')}`,
)

/** The time a zone is tied to when the switch is turned on before a time is set (#588). */
const TIME_FOR_A_ZONE = '09:00'

/** A task's due time as the forms hold it: no time is `''`, a floating time has no zone. */
export type DueTimeValue = { time: string; zone: string | null }

type DueTimeFieldProps = {
  value: DueTimeValue
  onChange: (value: DueTimeValue) => void
}

/**
 * The optional due time in the add and edit forms (#476), and the switch that ties it to a time
 * zone, shown from the start (#588): turned on before a time is set, it sets 09:00, since a zone
 * says nothing without a time and the backend refuses one alone, and turned off again it takes that
 * 09:00 back. On a desktop a button beside the
 * time opens a list of the quarter hours, as desktop Safari and Firefox offer no picker of their
 * own; any minute can still be typed.
 *
 * The switch is off by default, a floating time, as Gunnar decided on #290; turned on it starts
 * from the browser's zone, which the picker can change. Clearing the time clears the zone with it,
 * because a zone says nothing without a time, and the backend refuses one alone. The time is a
 * native `input type="time"` and the switch a checkbox with the `switch` role, so keyboards and
 * screen readers handle both as they handle any other.
 */
function DueTimeField({ value, onChange }: Readonly<DueTimeFieldProps>) {
  const { messages } = useI18n()
  const [desktop] = useState(onDesktop)
  const timeId = useId()
  const zoneId = useId()
  // The zone the switch last held, so turning it off and on again gives a task back its own.
  const lastZone = useRef(value.zone)
  // Whether the time is the 09:00 the switch set, which turning it off takes back.
  const timeFromSwitch = useRef(false)

  return (
    <>
      <div className="add-field">
        <label htmlFor={timeId}>{messages.dueTime.label}</label>
        <div className={desktop ? 'time-field-row' : undefined}>
          <input
            id={timeId}
            type="time"
            value={value.time}
            onChange={(event) => {
              const time = event.target.value
              // A time half typed, or a part being typed again, reads as none: it is not cleared, and
              // the browser keeps the form from being sent until it is whole.
              if (time === '' && event.target.validity.badInput) {
                return
              }
              if (time === '' && value.zone !== null) {
                lastZone.current = value.zone
              }
              timeFromSwitch.current = false
              onChange({ time, zone: time === '' ? null : value.zone })
            }}
          />
          {desktop ? (
            <TimeList
              value={value.time}
              onPick={(time) => {
                timeFromSwitch.current = false
                onChange({ time, zone: value.zone })
              }}
            />
          ) : null}
        </div>
      </div>
      <label className="zone-switch">
        <input
          type="checkbox"
          role="switch"
          checked={value.zone !== null}
          onChange={(event) => {
            if (value.zone !== null) {
              lastZone.current = value.zone
            }
            const zone = event.target.checked ? (lastZone.current ?? browserZone()) : null
            if (zone !== null && value.time === '') {
              timeFromSwitch.current = true
              onChange({ time: TIME_FOR_A_ZONE, zone })
            } else if (zone === null && timeFromSwitch.current) {
              timeFromSwitch.current = false
              onChange({ time: '', zone })
            } else {
              onChange({ time: value.time, zone })
            }
          }}
        />
        <span>{messages.dueTime.tied}</span>
      </label>
      {value.time === '' || value.zone === null ? null : (
        <div className="add-field">
          <label htmlFor={zoneId}>{messages.dueTime.zone}</label>
          <ZoneSelect id={zoneId} zone={value.zone} onChange={(zone) => onChange({ ...value, zone })} />
        </div>
      )}
    </>
  )
}

/** The quarter hour nearest a time, for the list to open at: 14:10 is 14:15, 23:55 is 23:45. */
function nearestQuarter(time: string) {
  const [hours, minutes] = time.split(':').map(Number)
  const quarter = Math.min(Math.round((hours * 60 + minutes) / 15), LISTED_TIMES.length - 1)
  return LISTED_TIMES[quarter]
}

/**
 * The desktop's list of times (#588), opened from the clock button beside the field: a pick sets
 * the time and closes it, as Escape and a click elsewhere do, and the focus goes back to the
 * button (`popover.ts`). It opens at the quarter hour nearest the time set, or the hour about to
 * come, with the focus there; the arrow keys move through it, and Enter or Space picks.
 */
function TimeList({ value, onPick }: Readonly<{ value: string; onPick: (time: string) => void }>) {
  const { messages } = useI18n()
  const listId = useId()
  const wrapper = useRef<HTMLSpanElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const { open, setOpen, closeToButton } = usePopover(wrapper, toggle)

  useEffect(() => {
    if (!open) {
      return
    }
    const start = value ? nearestQuarter(value) : `${String((new Date().getHours() + 1) % 24).padStart(2, '0')}:00`
    const chosen = list.current?.querySelector<HTMLElement>(`[data-time="${start}"]`) ?? null
    chosen?.scrollIntoView?.({ block: 'center' })
    // The keyboard starts in the list, at the time it opened at; the arrow keys move from there.
    chosen?.focus()
  }, [open, value])

  const pick = (time: string) => {
    onPick(time)
    closeToButton()
  }

  return (
    <span className="time-field-picker" ref={wrapper}>
      <button
        ref={toggle}
        type="button"
        className="date-field-toggle"
        aria-label={messages.dueTime.list}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 6v4.25l2.75 1.75" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open ? (
        <ul
          ref={list}
          id={listId}
          className="time-field-popover"
          role="listbox"
          aria-label={messages.dueTime.list}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
              return
            }
            event.preventDefault()
            const current = document.activeElement
            const next =
              current instanceof HTMLElement && list.current?.contains(current)
                ? event.key === 'ArrowDown'
                  ? current.nextElementSibling
                  : current.previousElementSibling
                : null
            if (next instanceof HTMLElement) {
              next.focus()
              next.scrollIntoView?.({ block: 'nearest' })
            }
          }}
        >
          {LISTED_TIMES.map((time) => (
            <li
              key={time}
              role="option"
              aria-selected={time === value}
              data-time={time}
              tabIndex={-1}
              onClick={() => pick(time)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  pick(time)
                }
              }}
            >
              {time}
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  )
}

/** The zone picker, listing the zones only once it is shown: the list is long, and most forms set no zone. */
function ZoneSelect({ id, zone, onChange }: Readonly<{ id: string; zone: string; onChange: (zone: string) => void }>) {
  const zones = useMemo(() => timeZones(zone), [zone])
  return (
    <select id={id} value={zone} onChange={(event) => onChange(event.target.value)}>
      {zones.map((each) => (
        <option key={each} value={each}>
          {each.replaceAll('_', ' ')}
        </option>
      ))}
    </select>
  )
}

export default DueTimeField
