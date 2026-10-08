import { useState } from 'react'
import { attachmentLimits, attachmentTypes } from '../api'
import { useI18n } from '../i18n/context'

type FileDropProps = {
  /** The files chosen or dropped, as one batch. */
  onFiles: (files: File[]) => void
}

/**
 * Where files are dropped or chosen (#204, #216): the editor attaches them at once, the add row
 * holds them until the task exists. The limits are said here, before anything is chosen, so nobody
 * uploads ten megabytes to learn there was no room.
 */
function FileDrop({ onFiles }: Readonly<FileDropProps>) {
  const { messages } = useI18n()
  const [dragging, setDragging] = useState(false)
  const megabytes = attachmentLimits.maxSizeBytes / (1024 * 1024)

  return (
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
        onFiles([...event.dataTransfer.files])
      }}
    >
      <span>{messages.attachments.drop}</span>{' '}
      <label className="attachment-choose">
        {messages.attachments.choose}
        <input
          type="file"
          multiple
          className="visually-hidden"
          accept={attachmentTypes.join(',')}
          onChange={(event) => {
            const files = [...(event.target.files ?? [])]
            event.target.value = ''
            onFiles(files)
          }}
        />
      </label>
      <p className="attachment-hint">
        {messages.attachments.limits(megabytes, attachmentLimits.perTask, attachmentLimits.perUser)}
      </p>
    </div>
  )
}

export default FileDrop
