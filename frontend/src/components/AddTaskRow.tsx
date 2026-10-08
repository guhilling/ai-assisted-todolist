import { useEffect, useRef, useState } from 'react'
import type { TaskImportance, TaskInput } from '../api'
import { addDays, quickDates } from '../dates'
import { importanceLevels } from '../importance'
import DueDateField from './DueDateField'
import { useEscapeWithin } from '../escape'
import { useI18n } from '../i18n/context'

type AddTaskRowProps = {
  today: string
  saving: boolean
  onAdd: (input: TaskInput) => Promise<boolean>
}

/**
 * The inline "add a task" affordance at the top of the board.
 *
 * Collapsed it is a single row, so the board opens as a list rather than as a form. Expanded
 * it offers the four dates a task is almost always due on, which is the point: typing a date
 * is the slowest part of adding a task, and the default of tomorrow means the common case
 * needs no date interaction at all.
 */
function AddTaskRow({ today, saving, onAdd }: Readonly<AddTaskRowProps>) {
  const { messages } = useI18n()
  const [open, setOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState(addDays(today, 1))
  const [importance, setImportance] = useState<TaskImportance>('MEDIUM')
  const descriptionRef = useRef<HTMLInputElement>(null)
  const form = useRef<HTMLFormElement>(null)

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
    const saved = await onAdd({ description: description.trim(), dueDate, importance, state: 'TODO' })
    if (saved) {
      reset()
      descriptionRef.current?.focus()
    }
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
          <button type="submit" className="button-primary" disabled={saving || description.trim() === ''}>
            {saving ? messages.addRow.adding : messages.addRow.add}
          </button>
        </div>
      </div>
    </form>
  )
}

export default AddTaskRow
