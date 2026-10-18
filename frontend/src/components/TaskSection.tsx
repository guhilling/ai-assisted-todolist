import type { Task, TaskState } from '../api'
import type { AttachmentActions } from './AttachmentList'
import type { TaskEdit } from './TaskEditor'
import TaskRow from './TaskRow'

type TaskSectionProps = {
  title: string
  /** The weekday the title does not say, beside it: Today's and Tomorrow's (#337). */
  weekday?: string | null
  tasks: Task[]
  today: string
  overdue?: boolean
  onToggleDone: (task: Task) => void
  onSetState: (task: Task, state: TaskState) => void
  onDelete: (task: Task) => void
  onEdit: (task: Task, changes: TaskEdit) => Promise<boolean>
  attachments?: AttachmentActions
}

/**
 * One dated group of the board, with its heading.
 *
 * Grouping by when something is due rather than showing one flat list is what makes the board
 * answerable at a glance: the question is nearly always "what is late and what is today", and
 * a single list ordered by date makes that a reading exercise.
 */
function TaskSection({
  title,
  weekday,
  tasks,
  today,
  overdue,
  onToggleDone,
  onSetState,
  onDelete,
  onEdit,
  attachments,
}: Readonly<TaskSectionProps>) {
  if (tasks.length === 0) {
    return null
  }

  return (
    <section className="task-section">
      {/* The weekday beside the heading rather than in it: the heading names the section. */}
      <div className="section-head">
        <h2 className={overdue ? 'section-title section-title--overdue' : 'section-title'}>{title}</h2>
        {weekday ? <span className="section-weekday">{weekday}</span> : null}
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
            onEdit={onEdit}
            attachments={attachments}
          />
        ))}
      </ul>
    </section>
  )
}

export default TaskSection
