import { useRef, useState } from 'react'
import { attachmentLimits, attachmentTypes, type Task } from '../api'
import { useI18n } from '../i18n/context'
import type { AttachmentActions } from './AttachmentList'

type AttachmentPickerProps = {
  task: Task
  actions: AttachmentActions
}

/** A file on its way up, with how far it has got. */
type Upload = { key: number; fileName: string; fraction: number }

/**
 * Attaching files to a task, in its editor (#204): choose one or drop it, see it go up, and read
 * why when one is refused. The limits are said before anything is chosen, so nobody uploads ten
 * megabytes to learn there was no room.
 *
 * A file is attached the moment it has uploaded -- it is not held back until Save, and Cancel
 * does not take it off again. An upload is a transfer, not a field of the form, and holding it
 * would mean an object in storage that the task does not know about yet.
 */
function AttachmentPicker({ task, actions }: Readonly<AttachmentPickerProps>) {
  const { messages } = useI18n()
  const [uploads, setUploads] = useState<Upload[]>([])
  const [problems, setProblems] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const nextKey = useRef(0)
  const attachments = task.attachments ?? []
  const full = attachments.length + uploads.length >= attachmentLimits.perTask

  /** Uploads one file, with its own progress bar and, if it fails, its own message. */
  const uploadOne = async (file: File) => {
    nextKey.current += 1
    const key = nextKey.current
    setUploads((current) => [...current, { key, fileName: file.name, fraction: 0 }])
    const outcome = await actions.upload(task, file, (fraction) =>
      setUploads((current) => current.map((upload) => (upload.key === key ? { ...upload, fraction } : upload))),
    )
    setUploads((current) => current.filter((upload) => upload.key !== key))
    if ('refusal' in outcome) {
      setProblems((current) => [...current, messages.attachments.refusals[outcome.refusal](file.name)])
    } else if ('failed' in outcome) {
      setProblems((current) => [...current, messages.attachments.uploadFailed(file.name)])
    }
  }

  /**
   * Several files go up at once, each with its own bar. The backend serialises the limit checks
   * per user, so a file past the task's limit is refused with its reason like any other.
   */
  const uploadAll = async (files: File[]) => {
    setProblems([])
    await Promise.all(files.map(uploadOne))
  }

  const megabytes = attachmentLimits.maxSizeBytes / (1024 * 1024)

  return (
    <fieldset className="attachment-picker">
      <legend>{messages.attachments.title}</legend>

      {attachments.length > 0 ? (
        <ul className="attachment-picker-list">
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <span className="attachment-name">{attachment.fileName}</span>
              <button
                type="button"
                className="attachment-remove"
                aria-label={messages.attachments.remove(attachment.fileName)}
                onClick={() => actions.remove(task, attachment)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {uploads.map((upload) => (
        <progress
          key={upload.key}
          className="attachment-progress"
          aria-label={messages.attachments.uploading(upload.fileName)}
          value={upload.fraction}
          max={1}
        />
      ))}

      {full ? (
        <p className="attachment-hint">{messages.attachments.full(attachmentLimits.perTask)}</p>
      ) : (
        <div
          className={dragging ? 'attachment-drop attachment-drop--active' : 'attachment-drop'}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            void uploadAll([...event.dataTransfer.files])
          }}
        >
          <span>{messages.attachments.drop}</span>{' '}
          <label className="attachment-choose">
            {messages.attachments.choose}
            <input
              type="file"
              className="visually-hidden"
              accept={attachmentTypes.join(',')}
              onChange={(event) => {
                const files = [...(event.target.files ?? [])]
                event.target.value = ''
                void uploadAll(files)
              }}
            />
          </label>
          <p className="attachment-hint">
            {messages.attachments.limits(megabytes, attachmentLimits.perTask, attachmentLimits.perUser)}
          </p>
        </div>
      )}

      {problems.map((problem) => (
        <p key={problem} className="attachment-problem" role="alert">
          {problem}
        </p>
      ))}
    </fieldset>
  )
}

export default AttachmentPicker
