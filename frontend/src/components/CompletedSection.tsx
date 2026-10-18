import type { Task } from '../api'
import type { AttachmentActions } from './AttachmentList'
import TaskRow from './TaskRow'
import { useI18n } from '../i18n/context'

type CompletedSectionProps = {
  tasks: Task[]
  today: string
  onToggleDone: (task: Task) => void
  onDelete: (task: Task) => void
  onClear: () => void
  attachments?: AttachmentActions
}

/**
 * Finished tasks, folded away.
 *
 * Collapsed by default because a completed task has served its purpose the moment it is
 * ticked, but kept rather than hidden so a mis-click can be undone by ticking it back. The
 * count on the summary is what makes the section worth opening.
 */
function CompletedSection({
  tasks,
  today,
  onToggleDone,
  onDelete,
  onClear,
  attachments,
}: Readonly<CompletedSectionProps>) {
  const { messages } = useI18n()
  if (tasks.length === 0) {
    return null
  }

  return (
    <details className="completed-section">
      <summary>
        <span className="section-title">{messages.completed.title(tasks.length)}</span>
      </summary>
      <div className="completed-actions">
        <button type="button" className="button-quiet" onClick={onClear}>
          {messages.completed.clear}
        </button>
      </div>
      <ul className="task-list">
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            today={today}
            onToggleDone={onToggleDone}
            onDelete={onDelete}
            attachments={attachments}
          />
        ))}
      </ul>
    </details>
  )
}

export default CompletedSection
