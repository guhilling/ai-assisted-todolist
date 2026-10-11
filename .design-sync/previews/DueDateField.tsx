import { DueDateField } from 'frontend'

const noop = () => {}

/**
 * Opens the calendar the way a visitor does: by pressing the button next to the field.
 *
 * The field has no prop for an open calendar -- it is opened only by the button -- so this
 * clicks it once on mount. The calendar is the component's own, loaded by the component.
 */
function Opened({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{ minHeight: 380 }}
      ref={(node) => {
        const toggle = node?.querySelector<HTMLButtonElement>('.date-field-toggle')
        if (toggle?.getAttribute('aria-expanded') === 'false') {
          toggle.click()
        }
      }}
    >
      {children}
    </div>
  )
}

/** The field as both forms show it: a date to type, and the button that opens a calendar. */
export function Default() {
  return <DueDateField value="2026-03-18" onChange={noop} />
}

/** The calendar open under the field, with the chosen day marked. */
export function CalendarOpen() {
  return (
    <Opened>
      <DueDateField value="2026-03-18" onChange={noop} />
    </Opened>
  )
}

/** Adding a task sets today as the earliest day, so the days before it cannot be picked. */
export function WithEarliestDay() {
  return (
    <Opened>
      <DueDateField value="2026-03-18" min="2026-03-16" onChange={noop} />
    </Opened>
  )
}
