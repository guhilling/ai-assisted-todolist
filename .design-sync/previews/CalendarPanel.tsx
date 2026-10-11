import { CalendarPanel } from 'frontend'

const noop = () => {}

/**
 * The calendar takes its colours from the board's tokens through react-day-picker's own CSS
 * variables, and those are set under `.date-field` -- where `DueDateField` puts it. Outside it,
 * the calendar would show the library's defaults rather than this board's.
 */
function InDateField({ children }: { children: React.ReactNode }) {
  return (
    <div className="date-field">
      {/* In the field the popover floats under the input; here it sits in the card, as wide as its month. */}
      <div className="date-field-popover" style={{ position: 'static', display: 'inline-block' }}>
        {children}
      </div>
    </div>
  )
}

/** A month, weeks starting on Monday, with the chosen day marked. */
export function Default() {
  return (
    <InDateField>
      <CalendarPanel value="2026-03-18" onPick={noop} />
    </InDateField>
  )
}

/** With an earliest day: the days before it are shown but cannot be picked. */
export function WithEarliestDay() {
  return (
    <InDateField>
      <CalendarPanel value="2026-03-18" min="2026-03-16" onPick={noop} />
    </InDateField>
  )
}
