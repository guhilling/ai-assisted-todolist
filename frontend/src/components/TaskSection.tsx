import type { Task, TaskState } from '../api'
import type { TaskEdit } from './TaskEditor'
import TaskRow from './TaskRow'

type TaskSectionProps = {
  title: string
  tasks: Task[]
  today: string
  overdue?: boolean
  onToggleDone: (task: Task) => void
  onSetState: (task: Task, state: TaskState) => void
  onDelete: (task: Task) => void
  onEdit: (task: Task, changes: TaskEdit) => Promise<boolean>
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
  tasks,
  today,
  overdue,
  onToggleDone,
  onSetState,
  onDelete,
  onEdit,
}: Readonly<TaskSectionProps>) {
  if (tasks.length === 0) {
    return null
  }

  return (
    <section className="task-section">
      <h2 className={overdue ? 'section-title section-title--overdue' : 'section-title'}>{title}</h2>
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
          />
        ))}
      </ul>
    </section>
  )
}

export default TaskSection
