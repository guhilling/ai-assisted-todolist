import { AttachmentList, type AttachmentActions, type Task } from 'frontend'

const noop = () => {}

/**
 * An image's preview, as a data URI.
 *
 * The list asks the board for a link to each image and shows what comes back. A real URL would
 * not load in a card, and the list would show its empty loading box instead -- so the link is a
 * small picture the card carries with it.
 */
const PICTURE =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 90">' +
      '<rect width="120" height="90" fill="#cfe3f2"/>' +
      '<circle cx="88" cy="24" r="10" fill="#f4c542"/>' +
      '<path d="M0 90 L38 44 L62 70 L80 52 L120 90 Z" fill="#4f8a5b"/>' +
      '</svg>',
  )

const actions: AttachmentActions = {
  link: () => Promise.resolve(PICTURE),
  open: noop,
  remove: noop,
  upload: () => Promise.resolve({ ok: true }),
}

const task: Task = {
  id: 1,
  description: 'Claim the travel expenses',
  dueDate: '2026-03-18',
  importance: 'MEDIUM',
  state: 'TODO',
  attachments: [
    { id: 21, fileName: 'hotel-receipt.jpg', contentType: 'image/jpeg', sizeBytes: 640_000, thumbnail: true },
    { id: 22, fileName: 'train-ticket.pdf', contentType: 'application/pdf', sizeBytes: 96_000, thumbnail: false },
  ],
}

/** On an open task's row: an image as a small preview, a PDF by its name, each removable. */
export function Default() {
  return <AttachmentList task={task} actions={actions} removable />
}

/** On a completed task the files can still be opened, but not removed. */
export function ReadOnly() {
  return <AttachmentList task={{ ...task, state: 'DONE' }} actions={actions} removable={false} />
}
