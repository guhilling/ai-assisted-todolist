import { AddTaskRow, type TaskInput } from 'frontend'

const TODAY = '2026-03-16'
/** Accepts every task, as the backend would, giving back the task as created. */
const accept = async (input: TaskInput) => ({ ...input, id: 1 })

/**
 * The row as the board shows it: collapsed to a single affordance until someone uses it.
 *
 * Only the one story. The `saving` state exists and is worth knowing about, but it is only
 * visible once the row has been expanded by a click, and a static card cannot click. A second
 * export would have rendered identically to this one and told a reader nothing.
 */
export function Default() {
  return <AddTaskRow today={TODAY} saving={false} onAdd={accept} />
}
