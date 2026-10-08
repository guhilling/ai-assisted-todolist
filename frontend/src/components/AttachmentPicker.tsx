import { attachmentLimits, type Task } from '../api'
import { useI18n } from '../i18n/context'
import type { AttachmentActions } from './AttachmentList'
import FileDrop from './FileDrop'
import { useUploads, withinRoom, type Problem, type Upload } from './useUploads'

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
  const { uploads, problems, addProblem, clearProblems, uploadAll } = useUploads(actions.upload)
  const attachments = task.attachments ?? []
  const room = attachmentLimits.perTask - attachments.length - uploads.length

  return (
    <fieldset className="attachment-picker">
      <legend>{messages.attachments.title}</legend>

      <FileList
        files={attachments.map((attachment) => ({ key: attachment.id, name: attachment.fileName }))}
        onRemove={(key) => {
          const attachment = attachments.find((each) => each.id === key)
          if (attachment) {
            actions.remove(task, attachment)
          }
        }}
      />

      <UploadProgress uploads={uploads} />

      {room <= 0 ? (
        <p className="attachment-hint">{messages.attachments.full(attachmentLimits.perTask)}</p>
      ) : (
        <FileDrop
          onFiles={(files) => {
            clearProblems()
            const { fitting, beyond } = withinRoom(files, room)
            beyond.forEach((file) => addProblem(messages.attachments.refusals.TASK_FULL(file.name)))
            void uploadAll(task, fitting)
          }}
        />
      )}

      <Problems problems={problems} />
    </fieldset>
  )
}

/** The files on a task or held for one, each with its remove button -- the editor's and the add row's. */
export function FileList({
  files,
  onRemove,
  disabled = false,
}: Readonly<{ files: { key: number; name: string }[]; onRemove: (key: number) => void; disabled?: boolean }>) {
  const { messages } = useI18n()
  if (files.length === 0) {
    return null
  }
  return (
    <ul className="attachment-picker-list">
      {files.map((file) => (
        <li key={file.key}>
          <span className="attachment-name">{file.name}</span>
          <button
            type="button"
            className="attachment-remove"
            aria-label={messages.attachments.remove(file.name)}
            disabled={disabled}
            onClick={() => onRemove(file.key)}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  )
}

/** A progress bar per file on its way up. */
export function UploadProgress({ uploads }: Readonly<{ uploads: Upload[] }>) {
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
export function Problems({ problems }: Readonly<{ problems: Problem[] }>) {
  return (
    <>
      {problems.map((problem) => (
        <p key={problem.key} className="attachment-problem" role="alert">
          {problem.text}
        </p>
      ))}
    </>
  )
}

export default AttachmentPicker
