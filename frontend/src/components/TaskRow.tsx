import { useEffect, useState } from 'react'
import type { Task, TaskState } from '../api'
import { describeDueDate, daysBetween } from '../dates'

/** How a task's importance reads on the row. */
const importanceLabels: Record<Task['importance'], string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
}

type TaskRowProps = {
  task: Task
  today: string
  onToggleDone: (task: Task) => void
  onSetState: (task: Task, state: TaskState) => void
  onDelete: (task: Task) => void
}

/**
 * One line of the board: a checkbox, what needs doing, and when.
 *
 * The checkbox is a real `input type="checkbox"` rather than a styled button, so its keyboard
 * handling, focus ring and screen-reader role come for free and cannot drift. Its accessible
 * name carries the description, because a board of identically-named checkboxes is unusable
 * to anyone not looking at it.
 */
function TaskRow({ task, today, onToggleDone, onSetState, onDelete }: TaskRowProps) {
  const done = task.state === 'DONE'
  const overdue = !done && daysBetween(today, task.dueDate) < 0
  const inputId = `task-${task.id}`
  const menuId = `task-menu-${task.id}`
  const [menuOpen, setMenuOpen] = useState(false)

  /**
   * A native `<details>` has no notion of dismissal: it stays open until something closes it,
   * so without this every menu opened piles up over the board.
   *
   * The click is tested for being inside this menu rather than relying on the listener being
   * attached after the opening click. React can flush the effect while that click is still
   * propagating, which closed the menu the instant it opened -- in a real browser, though not
   * in jsdom, so only the end-to-end run caught it.
   */
  useEffect(() => {
    if (!menuOpen) {
      return
    }

    const closeUnlessInside = (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest(`#${menuId}`) === null) {
        setMenuOpen(false)
      }
    }

    document.addEventListener('click', closeUnlessInside)
    return () => document.removeEventListener('click', closeUnlessInside)
  }, [menuOpen, menuId])

  return (
    <li className={`task-row${done ? ' task-row--done' : ''}`}>
      <input
        className="task-check"
        type="checkbox"
        id={inputId}
        checked={done}
        onChange={() => onToggleDone(task)}
        aria-label={`Mark "${task.description}" as done`}
      />
      <div className="task-body">
        <label className="task-description" htmlFor={inputId}>
          {task.description}
        </label>
        <p className="task-meta">
          <span className={overdue ? 'task-due task-due--overdue' : 'task-due'}>
            {describeDueDate(task.dueDate, today)}
          </span>
          <span className={`task-importance task-importance--${task.importance.toLowerCase()}`}>
            {importanceLabels[task.importance]}
          </span>
          {task.state === 'WORKING' ? <span className="task-chip">doing</span> : null}
        </p>
      </div>
      <details className="task-menu" id={menuId} open={menuOpen}>
        <summary
          aria-label={`Actions for "${task.description}"`}
          onClick={(event) => {
            // The native toggle is suppressed so `menuOpen` is the only thing that decides,
            // rather than racing the `toggle` event, which browsers fire asynchronously.
            event.preventDefault()
            setMenuOpen((open) => !open)
          }}
        >
          ⋯
        </summary>
        <div className="task-menu-items">
          {task.state === 'WORKING' ? (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                onSetState(task, 'TODO')
              }}
            >
              Mark as not started
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                onSetState(task, 'WORKING')
              }}
            >
              Mark as in progress
            </button>
          )}
          <button
            type="button"
            className="task-menu-danger"
            onClick={() => {
                setMenuOpen(false)
                onDelete(task)
              }}
          >
            Delete
          </button>
        </div>
      </details>
    </li>
  )
}

export default TaskRow
