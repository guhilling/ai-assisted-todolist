import { useEffect, useState } from 'react'
import type { Attachment, AttachmentRefusal, Task } from '../api'
import { useI18n } from '../i18n/context'

/** How an upload ended: done, refused for a reason the board can word, or failed. */
export type UploadOutcome = { ok: true } | { refusal: AttachmentRefusal } | { failed: true }

/**
 * What the board does with a task's files (#204). The components only call these; the board owns
 * the requests, as it does for tasks.
 */
export type AttachmentActions = {
  /**
   * A link that shows the file, or its preview thumbnail (#236), for an image's inline preview. By
   * ids, and expected to be the same function on every render, so a preview asks once per file
   * rather than once per render.
   */
  link: (taskId: Task['id'], attachmentId: Attachment['id'], thumbnail: boolean) => Promise<string>
  /** Opens the file in a new tab. */
  open: (task: Task, attachment: Attachment) => void
  /** Removes the file from the task, for good. */
  remove: (task: Task, attachment: Attachment) => void
  /** Uploads a file to the task, reporting progress as a fraction. */
  upload: (task: Task, file: File, onProgress: (fraction: number) => void) => Promise<UploadOutcome>
}

type AttachmentListProps = {
  task: Task
  actions: AttachmentActions
  /** Whether the files may be removed here; a completed task's may only be opened. */
  removable: boolean
}

/**
 * A task's files on its row: an image as a small preview (D2 on #204), a PDF by its name, each
 * opening in a new tab when clicked, and each removable while the task is open.
 *
 * The preview is the image's thumbnail when it has one (#236) -- a few kilobytes the browser made
 * while uploading it -- and the file itself otherwise, through a link asked for when the row
 * appears.
 */
function AttachmentList({ task, actions, removable }: Readonly<AttachmentListProps>) {
  const { messages } = useI18n()
  const attachments = task.attachments ?? []
  if (attachments.length === 0) {
    return null
  }

  return (
    <ul className="attachment-list">
      {attachments.map((attachment) => (
        <li key={attachment.id} className="attachment-item">
          <button
            type="button"
            className="attachment-open"
            aria-label={messages.attachments.open(attachment.fileName)}
            onClick={() => actions.open(task, attachment)}
          >
            {attachment.contentType.startsWith('image/') ? (
              <Preview taskId={task.id} attachment={attachment} link={actions.link} />
            ) : (
              <span className="attachment-name">
                <span aria-hidden="true">📄 </span>
                {attachment.fileName}
              </span>
            )}
          </button>
          {removable ? (
            <button
              type="button"
              className="attachment-remove"
              aria-label={messages.attachments.remove(attachment.fileName)}
              onClick={() => actions.remove(task, attachment)}
            >
              ×
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/**
 * An image, shown once its link has arrived; until then, a box of the same size. Its thumbnail when
 * it has one, and the file itself when it has none or the thumbnail cannot be shown -- a database
 * restored from a snapshot can name a thumbnail that is no longer there.
 */
function Preview({
  taskId,
  attachment,
  link,
}: Readonly<{ taskId: Task['id']; attachment: Attachment; link: AttachmentActions['link'] }>) {
  const [source, setSource] = useState<string | null>(null)
  const [thumbnail, setThumbnail] = useState(attachment.thumbnail)
  const attachmentId = attachment.id

  useEffect(() => {
    let current = true
    link(taskId, attachmentId, thumbnail)
      .then((url) => {
        if (current) {
          setSource(url)
        }
      })
      // No thumbnail is the file instead; no preview at all is not worth a banner, as the file
      // still opens from the box.
      .catch(() => {
        if (current && thumbnail) {
          setThumbnail(false)
        }
      })
    return () => {
      current = false
    }
  }, [link, taskId, attachmentId, thumbnail])

  return source ? (
    <img
      className="attachment-preview"
      src={source}
      alt={attachment.fileName}
      onError={thumbnail ? () => setThumbnail(false) : undefined}
    />
  ) : (
    <span className="attachment-preview attachment-preview--loading" aria-hidden="true" />
  )
}

export default AttachmentList
