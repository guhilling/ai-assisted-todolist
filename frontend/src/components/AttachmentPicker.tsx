import { attachmentLimits, type Task } from '../api'
import { useI18n } from '../i18n/context'
import type { AttachmentActions } from './AttachmentList'
import FileDrop from './FileDrop'
import { useUploads } from './useUploads'

type AttachmentPickerProps = {
  task: Task
  actions: AttachmentActions
}

/**
 * Attaching files to a task, in its editor (#204): choose one or drop it, see it go up, and read
 * why when one is refused.
 *
 * A file is attached the moment it has uploaded -- it is not held back until Save, and Cancel
 * does not take it off again. An upload is a transfer, not a field of the form, and holding it
 * would mean an object in storage that the task does not know about yet.
 */
function AttachmentPicker({ task, actions }: Readonly<AttachmentPickerProps>) {
  const { messages } = useI18n()
  const { uploads, problems, clearProblems, uploadAll } = useUploads(actions)
  const attachments = task.attachments ?? []
  const full = attachments.length + uploads.length >= attachmentLimits.perTask

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

      <UploadProgress uploads={uploads} />

      {full ? (
        <p className="attachment-hint">{messages.attachments.full(attachmentLimits.perTask)}</p>
      ) : (
        <FileDrop
          onFiles={(files) => {
            clearProblems()
            void uploadAll(task, files)
          }}
        />
      )}

      <Problems problems={problems} />
    </fieldset>
  )
}

/** A progress bar per file on its way up. */
export function UploadProgress({ uploads }: Readonly<{ uploads: ReturnType<typeof useUploads>['uploads'] }>) {
  const { messages } = useI18n()
  return (
    <>
      {uploads.map((upload) => (
        <progress
          key={upload.key}
          className="attachment-progress"
          aria-label={messages.attachments.uploading(upload.fileName)}
          value={upload.fraction}
          max={1}
        />
      ))}
    </>
  )
}

/** One sentence per file that did not make it, read out as it appears. */
export function Problems({ problems }: Readonly<{ problems: string[] }>) {
  return (
    <>
      {problems.map((problem) => (
        <p key={problem} className="attachment-problem" role="alert">
          {problem}
        </p>
      ))}
    </>
  )
}

export default AttachmentPicker
