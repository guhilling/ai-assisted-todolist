import { AttachmentPicker, type AttachmentActions, type Task } from 'frontend'

const noop = () => {}

const actions: AttachmentActions = {
  link: () => Promise.resolve(''),
  open: noop,
  remove: noop,
  upload: () => Promise.resolve({ ok: true }),
}

function task(attachments: Task['attachments']): Task {
  return {
    id: 1,
    description: 'Claim the travel expenses',
    dueDate: '2026-03-18',
    importance: 'MEDIUM',
    state: 'TODO',
    attachments,
  }
}

/** Nothing attached yet: the drop area, with the limits said before anything is chosen. */
export function Empty() {
  return <AttachmentPicker task={task([])} actions={actions} />
}

/** One file on the task, removable, and room for one more. */
export function OneFile() {
  return (
    <AttachmentPicker
      task={task([{ id: 21, fileName: 'train-ticket.pdf', contentType: 'application/pdf', sizeBytes: 96_000, thumbnail: false }])}
      actions={actions}
    />
  )
}

/** Both of a task's files in place: the drop area gives way to a sentence saying so. */
export function Full() {
  return (
    <AttachmentPicker
      task={task([
        { id: 21, fileName: 'train-ticket.pdf', contentType: 'application/pdf', sizeBytes: 96_000, thumbnail: false },
        { id: 22, fileName: 'hotel-receipt.jpg', contentType: 'image/jpeg', sizeBytes: 640_000, thumbnail: true },
      ])}
      actions={actions}
    />
  )
}
