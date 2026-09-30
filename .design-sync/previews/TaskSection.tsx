import { TaskSection, type Task } from 'frontend'

const TODAY = '2026-03-16'
const noop = () => {}
const handlers = { onToggleDone: noop, onSetState: noop, onDelete: noop }

function task(id: number, description: string, dueDate: string, extra: Partial<Task> = {}): Task {
  return { id, description, dueDate, importance: 'MEDIUM', state: 'TODO', ...extra }
}

export function Upcoming() {
  return (
    <TaskSection
      title="This week"
      today={TODAY}
      tasks={[
        task(1, 'Renew the passport', '2026-03-17', { importance: 'HIGH' }),
        task(2, 'Draft the migration plan', '2026-03-18', { state: 'WORKING' }),
        task(3, 'Water the plants', '2026-03-20', { importance: 'LOW' }),
      ]}
      {...handlers}
    />
  )
}

/** The overdue heading is the one thing this section says differently. */
export function OverdueSection() {
  return (
    <TaskSection
      title="Overdue"
      today={TODAY}
      overdue
      tasks={[
        task(4, 'Send the quarterly report', '2026-03-09', { importance: 'HIGH' }),
        task(5, 'Reply to the landlord', '2026-03-13'),
      ]}
      {...handlers}
    />
  )
}
