import { useEffect, useRef, useState } from 'react'
import { attachmentLimits, checkFile, type Task, type TaskImportance, type TaskInput } from '../api'
import { addDays, quickDates } from '../dates'
import { importanceLevels } from '../importance'
import type { AttachmentActions } from './AttachmentList'
import { FileList, Problems, UploadProgress } from './AttachmentPicker'
import DueDateField from './DueDateField'
import FileDrop from './FileDrop'
import { useUploads, withinRoom } from './useUploads'
import { useEscapeWithin } from '../escape'
import { useI18n } from '../i18n/context'

type AddTaskRowProps = {
  today: string
  saving: boolean
  /** Creates the task: the task as created, which held files are uploaded to, or false if it failed. */
  onAdd: (input: TaskInput) => Promise<Task | false>
  /** Attaching files while adding (#216); left out, the row offers none. */
  attachments?: AttachmentActions
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
 * attached again from the editor. Once everything has gone, the row closes, as the app's form does
 * (#383); a file that did not make it keeps it open, cleared, to say so. However it closes, the
 * focus returns to its button, where Enter or `n` starts the next task. From Add until then it is
 * locked -- fields, buttons, the drop zone and Escape -- so nothing typed or dropped meanwhile is
 * lost when it clears or closes. Escape does nothing from the moment Add is pressed, while the task is
 * created as well: closed then, the row would have its files go up for a row no longer there.
 */
function AddTaskRow({ today, saving, onAdd, attachments }: Readonly<AddTaskRowProps>) {
  const { messages } = useI18n()
  const [open, setOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState(addDays(today, 1))
  const [importance, setImportance] = useState<TaskImportance>('MEDIUM')
  const descriptionRef = useRef<HTMLInputElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  // Whether the row has been open, so its closing -- not the board's first drawing -- moves the focus.
  const wasOpen = useRef(false)
  // Set when Add did not close the row, so the description takes the focus once the row is unlocked.
  const refocus = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  const [held, setHeld] = useState<{ key: number; file: File }[]>([])
  const [sending, setSending] = useState(false)
  // Whether Add is under way: the task being created, then its files going up. Escape asks this,
  // not `saving` or `sending`: it is set as Add starts, where those change only once React draws
  // the row again, and an Escape in between would close it (#364). Closed while the task is being
  // created, the row would have its files go up for a row no longer there.
  const adding = useRef(false)
  const nextHeld = useRef(0)
  const files = useUploads(attachments?.upload)

  useEffect(() => {
    if (open) {
      wasOpen.current = true
      descriptionRef.current?.focus()
    } else if (wasOpen.current) {
      opener.current?.focus()
    }
  }, [open])

  // A locked fieldset cannot take the focus, so it is given back once React has unlocked it.
  useEffect(() => {
    if (open && !saving && !sending && refocus.current) {
      refocus.current = false
      descriptionRef.current?.focus()
    }
  }, [open, saving, sending])

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
    const sendable = chosen.filter((file) => {
      const refusal = checkFile(file)
      if (refusal) {
        files.addProblem(messages.attachments.refusals[refusal](file.name))
      }
      return refusal === null
    })
    const { fitting, beyond } = withinRoom(sendable, attachmentLimits.perTask - held.length)
    beyond.forEach((file) => files.addProblem(messages.attachments.refusals.TASK_FULL(file.name)))
    setHeld((current) => [
      ...current,
      ...fitting.map((file) => {
        nextHeld.current += 1
        return { key: nextHeld.current, file }
      }),
    ])
  }

  const collapse = () => {
    setOpen(false)
    reset()
    files.clearProblems()
  }

  useEscapeWithin(form, () => {
    if (!adding.current) {
      collapse()
    }
  })

  const submit = async () => {
    if (description.trim() === '') {
      return
    }
    // A new task is always TODO; the board has no reason to offer a state picker before the
    // task exists, but the backend requires the field.
    files.clearProblems()
    adding.current = true
    const saved = await onAdd({ description: description.trim(), dueDate, importance, state: 'TODO' })
    if (!saved) {
      adding.current = false
      refocus.current = true
      return
    }
    let arrived = true
    if (held.length > 0) {
      setSending(true)
      arrived = await files.uploadAll(
        saved,
        held.map((each) => each.file),
      )
      setSending(false)
    }
    adding.current = false
    reset()
    if (arrived) {
      setOpen(false)
    } else {
      refocus.current = true
    }
  }

  if (!open) {
    return (
      <button ref={opener} type="button" className="add-row" onClick={() => setOpen(true)}>
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
      {/* Locked from Add until the task and its files have gone: the row then clears or closes, so nothing may change meanwhile. */}
      <fieldset className="add-form-body" disabled={saving || sending}>
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
            <FileList
              files={held.map((each) => ({ key: each.key, name: each.file.name }))}
              onRemove={(key) => setHeld((current) => current.filter((each) => each.key !== key))}
            />
            <UploadProgress uploads={files.uploads} />
            {held.length >= attachmentLimits.perTask ? (
              <p className="attachment-hint">{messages.attachments.full(attachmentLimits.perTask)}</p>
            ) : (
              <FileDrop onFiles={hold} />
            )}
            <Problems problems={files.problems} />
          </fieldset>
        ) : null}
      </fieldset>
    </form>
  )
}

export default AddTaskRow
