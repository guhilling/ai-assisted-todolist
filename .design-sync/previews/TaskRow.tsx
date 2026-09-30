import { TaskRow, type Task } from 'frontend'

/**
 * A fixed today, with every due date written relative to it.
 *
 * The app's own fixtures compute dates from the real today on purpose, because the board
 * groups rows by how far away they are. A preview wants the opposite: both sides fixed, so the
 * distance -- and the words the row prints -- are the same in every screenshot.
 */
const TODAY = '2026-03-16'
const noop = () => {}

function task(overrides: Partial<Task> & { id: number }): Task {
  return {
    description: 'Renew the passport',
    dueDate: '2026-03-18',
    importance: 'MEDIUM',
    state: 'TODO',
    ...overrides,
  }
}

/** A row is an `<li>`: it belongs to the board's list, and is shown in one. */
function List({ children }: { children: React.ReactNode }) {
  return <ul className="task-list">{children}</ul>
}

const handlers = { onToggleDone: noop, onSetState: noop, onDelete: noop }

export function Default() {
  return (
    <List>
      <TaskRow task={task({ id: 1 })} today={TODAY} {...handlers} />
    </List>
  )
}

export function Overdue() {
  return (
    <List>
      <TaskRow
        task={task({ id: 2, description: 'Send the quarterly report', dueDate: '2026-03-11' })}
        today={TODAY}
        {...handlers}
      />
    </List>
  )
}

export function Done() {
  return (
    <List>
      <TaskRow
        task={task({ id: 3, description: 'Book the dentist', state: 'DONE', importance: 'LOW' })}
        today={TODAY}
        {...handlers}
      />
    </List>
  )
}

export function InProgress() {
  return (
    <List>
      <TaskRow
        task={task({ id: 4, description: 'Draft the migration plan', state: 'WORKING' })}
        today={TODAY}
        {...handlers}
      />
    </List>
  )
}

/** The importance dot differs in fill, not only colour, so it survives greyscale. */
export function Importance() {
  return (
    <List>
      <TaskRow task={task({ id: 5, description: 'Water the plants', importance: 'LOW' })} today={TODAY} {...handlers} />
      <TaskRow task={task({ id: 6, description: 'Renew the passport', importance: 'MEDIUM' })} today={TODAY} {...handlers} />
      <TaskRow task={task({ id: 7, description: 'Pay the tax bill', importance: 'HIGH' })} today={TODAY} {...handlers} />
    </List>
  )
}
