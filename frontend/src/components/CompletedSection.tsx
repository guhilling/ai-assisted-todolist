import type { Task, TaskState } from '../api'
import TaskRow from './TaskRow'

type CompletedSectionProps = {
  tasks: Task[]
  today: string
  onToggleDone: (task: Task) => void
  onSetState: (task: Task, state: TaskState) => void
  onDelete: (task: Task) => void
  onClear: () => void
}

/**
 * Finished tasks, folded away.
 *
 * Collapsed by default because a completed task has served its purpose the moment it is
 * ticked, but kept rather than hidden so a mis-click can be undone by ticking it back. The
 * count on the summary is what makes the section worth opening.
 */
function CompletedSection({ tasks, today, onToggleDone, onSetState, onDelete, onClear }: CompletedSectionProps) {
  if (tasks.length === 0) {
    return null
  }

  return (
    <details className="completed-section">
      <summary>
        <span className="section-title">Completed ({tasks.length})</span>
      </summary>
      <div className="completed-actions">
        <button type="button" className="button-quiet" onClick={onClear}>
          Clear completed
        </button>
      </div>
      <ul className="task-list">
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            today={today}
            onToggleDone={onToggleDone}
            onSetState={onSetState}
            onDelete={onDelete}
          />
        ))}
      </ul>
    </details>
  )
}

export default CompletedSection
