import { useEffect, useRef, useState } from 'react'
import { attachmentLimits, checkFile, type Task, type TaskImportance, type TaskInput } from '../api'
import { addDays, quickDates } from '../dates'
import { importanceLevels } from '../importance'
import type { AttachmentActions } from './AttachmentList'
import { Problems, UploadProgress } from './AttachmentPicker'
import DueDateField from './DueDateField'
import FileDrop from './FileDrop'
import { useUploads } from './useUploads'
import { useEscapeWithin } from '../escape'
import { useI18n } from '../i18n/context'

type AddTaskRowProps = {
  today: string
  saving: boolean
  /**
   * Creates the task: the created task, or whether it went where the caller has none to give --
   * files are uploaded only to a task it returns.
   */
  onAdd: (input: TaskInput) => Promise<Task | boolean>
  /** Attaching files while adding (#216); left out, the row offers none. */
  attachments?: AttachmentActions
}

/** What the row uploads with when it has no attachment actions: never called, since it offers no files. */
const NO_ACTIONS: AttachmentActions = {
  link: () => Promise.reject(new Error('no attachments here')),
  open: () => undefined,
  remove: () => undefined,
  upload: () => Promise.resolve({ failed: true }),
}

/**
 * The inline "add a task" affordance at the top of the board.
 *
 * Collapsed it is a single row, so the board opens as a list rather than as a form. Expanded
 * it offers the four dates a task is almost always due on, which is the point: typing a date
 * is the slowest part of adding a task, and the default of tomorrow means the common case
 * needs no date interaction at all.
 *
 * Files can be attached here too (#216). They are held in the browser until Add -- checked at once
 * for type, size and how many a task may have -- and uploaded once the task exists. A file that
 * cannot be attached then does not undo the task: the row says which and why, and it can be
 * attached again from the editor. The row clears once everything has gone.
 */
function AddTaskRow({ today, saving, onAdd, attachments }: Readonly<AddTaskRowProps>) {
  const { messages } = useI18n()
  const [open, setOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState(addDays(today, 1))
  const [importance, setImportance] = useState<TaskImportance>('MEDIUM')
  const descriptionRef = useRef<HTMLInputElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const [held, setHeld] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const files = useUploads(attachments ?? NO_ACTIONS)

  useEffect(() => {
    if (open) {
      descriptionRef.current?.focus()
    }
  }, [open])

  /**
   * `n` opens the add row from anywhere on the board, the way a list app is expected to work.
   *
   * It is ignored while the caret is in a field, or the shortcut would eat the letter as
   * somebody typed it, and ignored with a modifier held so it cannot shadow a browser or
   * screen-reader command.
   */
  useEffect(() => {
    if (open) {
      return
    }

    const openOnShortcut = (event: KeyboardEvent) => {
      if (event.key !== 'n' || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      const target = event.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable]') !== null) {
        return
      }

      event.preventDefault()
      setOpen(true)
    }

    document.addEventListener('keydown', openOnShortcut)
    return () => document.removeEventListener('keydown', openOnShortcut)
  }, [open])

  const reset = () => {
    setDescription('')
    setDueDate(addDays(today, 1))
    setImportance('MEDIUM')
    setHeld([])
  }

  /** Holds what may be sent, refusing at once what could not be: its type, its size, or no room. */
  const hold = (chosen: File[]) => {
    files.clearProblems()
    let room = attachmentLimits.perTask - held.length
    const accepted: File[] = []
    for (const file of chosen) {
      const refusal = checkFile(file) ?? (room > 0 ? null : 'TASK_FULL')
      if (refusal) {
        files.addProblem(messages.attachments.refusals[refusal](file.name))
      } else {
        accepted.push(file)
        room -= 1
      }
    }
    setHeld((current) => [...current, ...accepted])
  }

  const collapse = () => {
    setOpen(false)
    reset()
  }

  useEscapeWithin(form, collapse)

  const submit = async () => {
    if (description.trim() === '') {
      return
    }
    // A new task is always TODO; the board has no reason to offer a state picker before the
    // task exists, but the backend requires the field.
    files.clearProblems()
    const saved = await onAdd({ description: description.trim(), dueDate, importance, state: 'TODO' })
    if (!saved) {
      return
    }
    if (typeof saved === 'object' && held.length > 0) {
      setSending(true)
      await files.uploadAll(saved, held)
      setSending(false)
    }
    reset()
    descriptionRef.current?.focus()
  }

  if (!open) {
    return (
      <button type="button" className="add-row" onClick={() => setOpen(true)}>
        <span className="add-row-plus" aria-hidden="true">
          +
        </span>
        {messages.addRow.open}
        <kbd className="add-row-key" aria-hidden="true">
          n
        </kbd>
      </button>
    )
  }

  return (
    <form
      ref={form}
      className="add-form"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <input
        ref={descriptionRef}
        className="add-description"
        aria-label={messages.addRow.description}
        placeholder={messages.addRow.placeholder}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />

      <fieldset className="quick-dates">
        <legend className="visually-hidden">{messages.addRow.shortcuts}</legend>
        {quickDates(today, messages.dates).map((quick) => (
          <button
            key={quick.label}
            type="button"
            className={`chip${quick.iso === dueDate ? ' chip--active' : ''}`}
            aria-pressed={quick.iso === dueDate}
            onClick={() => setDueDate(quick.iso)}
          >
            {quick.label}
          </button>
        ))}
      </fieldset>

      <div className="add-controls">
        {/* min matches the backend, which refuses a new task dated in the past. */}
        <DueDateField value={dueDate} min={today} onChange={setDueDate} />
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
          <button type="button" className="button-quiet" onClick={collapse}>
            {messages.addRow.cancel}
          </button>
          <button type="submit" className="button-primary" disabled={saving || sending || description.trim() === ''}>
            {saving || sending ? messages.addRow.adding : messages.addRow.add}
          </button>
        </div>
      </div>

      {attachments ? (
        <fieldset className="attachment-picker">
          <legend>{messages.attachments.title}</legend>
          {held.length > 0 ? (
            <ul className="attachment-picker-list">
              {held.map((file, index) => (
                <li key={`${index}-${file.name}`}>
                  <span className="attachment-name">{file.name}</span>
                  <button
                    type="button"
                    className="attachment-remove"
                    aria-label={messages.attachments.remove(file.name)}
                    disabled={sending}
                    onClick={() => setHeld((current) => current.filter((_, at) => at !== index))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <UploadProgress uploads={files.uploads} />
          {held.length >= attachmentLimits.perTask ? (
            <p className="attachment-hint">{messages.attachments.full(attachmentLimits.perTask)}</p>
          ) : (
            <FileDrop onFiles={hold} />
          )}
          <Problems problems={files.problems} />
        </fieldset>
      ) : null}
    </form>
  )
}

export default AddTaskRow
