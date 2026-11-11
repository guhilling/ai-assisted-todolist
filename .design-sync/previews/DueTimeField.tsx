import { DueTimeField } from 'frontend'

const noop = () => {}

/** No time: the task is due on its day, the default. */
export function Empty() {
  return <DueTimeField value={{ time: '', zone: null }} onChange={noop} />
}

/** A floating time, 14:30 wherever the user is: the switch off. */
export function Floating() {
  return <DueTimeField value={{ time: '14:30', zone: null }} onChange={noop} />
}

/** Tied to a time zone: the switch on, and the zone it is meant in. */
export function Zoned() {
  return <DueTimeField value={{ time: '09:00', zone: 'Europe/Berlin' }} onChange={noop} />
}
