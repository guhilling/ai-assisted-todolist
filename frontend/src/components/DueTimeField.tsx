import { useId, useMemo, useRef } from 'react'
import { browserZone, timeZones } from '../dueTime'
import { useI18n } from '../i18n/context'

/** A task's due time as the forms hold it: no time is `''`, a floating time has no zone. */
export type DueTimeValue = { time: string; zone: string | null }

type DueTimeFieldProps = {
  value: DueTimeValue
  onChange: (value: DueTimeValue) => void
}

/**
 * The optional due time in the add and edit forms (#476), and with a time, the switch that ties it
 * to a time zone.
 *
 * The switch is off by default, a floating time, as Gunnar decided on #290; turned on it starts
 * from the browser's zone, which the picker can change. Clearing the time clears the zone with it,
 * because a zone says nothing without a time, and the backend refuses one alone. The time is a
 * native `input type="time"` and the switch a checkbox with the `switch` role, so keyboards and
 * screen readers handle both as they handle any other.
 */
function DueTimeField({ value, onChange }: Readonly<DueTimeFieldProps>) {
  const { messages } = useI18n()
  const timeId = useId()
  const zoneId = useId()
  // The zone the switch last held, so turning it off and on again gives a task back its own.
  const lastZone = useRef(value.zone)

  return (
    <>
      <div className="add-field">
        <label htmlFor={timeId}>{messages.dueTime.label}</label>
        <input
          id={timeId}
          type="time"
          value={value.time}
          onChange={(event) => {
            const time = event.target.value
            onChange({ time, zone: time === '' ? null : value.zone })
          }}
        />
      </div>
      {value.time === '' ? null : (
        <label className="zone-switch">
          <input
            type="checkbox"
            role="switch"
            checked={value.zone !== null}
            onChange={(event) => {
              if (value.zone !== null) {
                lastZone.current = value.zone
              }
              onChange({ time: value.time, zone: event.target.checked ? (lastZone.current ?? browserZone()) : null })
            }}
          />
          <span>{messages.dueTime.tied}</span>
        </label>
      )}
      {value.time === '' || value.zone === null ? null : (
        <div className="add-field">
          <label htmlFor={zoneId}>{messages.dueTime.zone}</label>
          <ZoneSelect id={zoneId} zone={value.zone} onChange={(zone) => onChange({ ...value, zone })} />
        </div>
      )}
    </>
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
