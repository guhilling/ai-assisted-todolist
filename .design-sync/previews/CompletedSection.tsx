import { CompletedSection, type Task } from 'frontend'

const TODAY = '2026-03-16'
const noop = () => {}
const handlers = { onToggleDone: noop, onSetState: noop, onDelete: noop, onClear: noop }

function done(id: number, description: string, dueDate: string, importance: Task['importance'] = 'MEDIUM'): Task {
  return { id, description, dueDate, importance, state: 'DONE' }
}

const finished = [
  done(1, 'Book the dentist', '2026-03-12', 'LOW'),
  done(2, 'Renew the library card', '2026-03-14'),
  done(3, 'Send the invoice', '2026-03-15', 'HIGH'),
]

/**
 * Opens the disclosure the section is built on.
 *
 * The component is a `<details>`, closed by default, and it exposes no prop to open it -- so a
 * card showing only the default renders a single summary line and says nothing about what the
 * section contains. This sets the attribute the element already understands, on mount, so the
 * expanded state is shown as the component itself would show it. Nothing is faked: closed is
 * the other card.
 */
function Opened({ children }: { children: React.ReactNode }) {
  return <div ref={(node) => node?.querySelector('details')?.setAttribute('open', '')}>{children}</div>
}

/** How the section sits on the board most of the time: folded away, with a count. */
export function Collapsed() {
  return <CompletedSection today={TODAY} tasks={finished} {...handlers} />
}

/** Opened: the completed rows, struck through, and the way to clear them. */
export function Expanded() {
  return (
    <Opened>
      <CompletedSection today={TODAY} tasks={finished} {...handlers} />
    </Opened>
  )
}
