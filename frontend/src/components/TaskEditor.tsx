import { useEffect, useRef, useState } from 'react'
import type { Task, TaskImportance } from '../api'
import { importanceLevels } from '../importance'
import type { AttachmentActions } from './AttachmentList'
import AttachmentPicker from './AttachmentPicker'
import DueDateField from './DueDateField'
import { useI18n } from '../i18n/context'

/** What editing may change. The state has its own controls: the checkbox and the row menu. */
export type TaskEdit = Pick<Task, 'description' | 'dueDate' | 'importance'>

type TaskEditorProps = {
  task: Task
  saving: boolean
  onSave: (changes: TaskEdit) => void
  onCancel: () => void
  /** Attaching files (#204); left out, the editor offers none. */
  attachments?: AttachmentActions
}

/**
 * A row turned into a form, for correcting a task that already exists.
 *
 * It offers the same three fields as adding a task, in the same layout, so editing needs no
 * new vocabulary. Unlike adding, the due date may stay in the past: a task that came due
 * yesterday is still yesterday's, and the backend accepts that on an update for the same
 * reason. Escape and Cancel discard; nothing reaches the server until Save.
 */
function TaskEditor({ task, saving, onSave, onCancel, attachments }: Readonly<TaskEditorProps>) {
  const { messages } = useI18n()
  const [description, setDescription] = useState(task.description)
  const [dueDate, setDueDate] = useState(task.dueDate)
  const [importance, setImportance] = useState<TaskImportance>(task.importance)
  const descriptionRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    descriptionRef.current?.focus()
  }, [])

  const blank = description.trim() === ''

  return (
    <form
      className="add-form task-editor"
      aria-label={messages.editor.label(task.description)}
      onSubmit={(event) => {
        event.preventDefault()
        if (!blank) {
          onSave({ description: description.trim(), dueDate, importance })
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onCancel()
        }
      }}
    >
      <input
        ref={descriptionRef}
        className="add-description"
        aria-label={messages.editor.description}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />

      <div className="add-controls">
        <DueDateField value={dueDate} onChange={setDueDate} />
        <label className="add-field">
          <span>{messages.importance.label}</span>
          <select value={importance} onChange={(event) => setImportance(event.target.value as TaskImportance)}>
            {importanceLevels.map((level) => (
              <option key={level} value={level}>
                {messages.importance.levels[level]}
              </option>
            ))}
          </select>
        </label>
        <div className="add-actions">
          <button type="button" className="button-quiet" onClick={onCancel}>
            {messages.editor.cancel}
          </button>
          <button type="submit" className="button-primary" disabled={saving || blank}>
            {saving ? messages.editor.saving : messages.editor.save}
          </button>
        </div>
      </div>
      {attachments ? <AttachmentPicker task={task} actions={attachments} /> : null}
    </form>
  )
}

export default TaskEditor
