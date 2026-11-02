import { useId, useMemo } from 'react'
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
  const zones = useMemo(() => timeZones(value.zone), [value.zone])

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
            onChange={(event) => onChange({ time: value.time, zone: event.target.checked ? browserZone() : null })}
          />
          <span>{messages.dueTime.tied}</span>
        </label>
      )}
      {value.time === '' || value.zone === null ? null : (
        <div className="add-field">
          <label htmlFor={zoneId}>{messages.dueTime.zone}</label>
          <select id={zoneId} value={value.zone} onChange={(event) => onChange({ ...value, zone: event.target.value })}>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  )
}

export default DueTimeField
