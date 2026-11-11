import { TaskEditor, type AttachmentActions, type Task } from 'frontend'

const noop = () => {}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    description: 'Renew the passport',
    dueDate: '2026-03-18',
    importance: 'MEDIUM',
    state: 'TODO',
    ...overrides,
  }
}

/** Nothing leaves the card: the board owns the requests, and a preview has no board. */
const attachments: AttachmentActions = {
  link: () => Promise.resolve(''),
  open: noop,
  remove: noop,
  upload: () => Promise.resolve({ ok: true }),
}

/**
 * The editor replaces its row in place: an `<li class="task-row task-row--editing">` in the
 * board's list. Shown there, because that is the only place it ever appears.
 */
function EditingRow({ children }: { children: React.ReactNode }) {
  return (
    <ul className="task-list">
      <li className="task-row task-row--editing">{children}</li>
    </ul>
  )
}

/** A row opened for correcting: description, due date, importance, then Cancel and Save. */
export function Default() {
  return (
    <EditingRow>
      <TaskEditor task={task()} saving={false} onSave={noop} onCancel={noop} />
    </EditingRow>
  )
}

/** While the change is on its way, Save says so and cannot be pressed twice. */
export function Saving() {
  return (
    <EditingRow>
      <TaskEditor task={task({ importance: 'HIGH' })} saving onSave={noop} onCancel={noop} />
    </EditingRow>
  )
}

/** With the board's file handling, the editor grows a place to attach files below the fields. */
export function WithAttachments() {
  return (
    <EditingRow>
      <TaskEditor
        task={task({
          description: 'Send the quarterly report',
          attachments: [{ id: 11, fileName: 'q1-figures.pdf', contentType: 'application/pdf', sizeBytes: 182_000, thumbnail: false }],
        })}
        saving={false}
        onSave={noop}
        onCancel={noop}
        attachments={attachments}
      />
    </EditingRow>
  )
}

/** A task already holding its two files: the drop area gives way to a sentence saying so. */
export function AttachmentsFull() {
  return (
    <EditingRow>
      <TaskEditor
        task={task({
          description: 'Claim the travel expenses',
          importance: 'LOW',
          attachments: [
            { id: 21, fileName: 'train-ticket.pdf', contentType: 'application/pdf', sizeBytes: 96_000, thumbnail: false },
            { id: 22, fileName: 'hotel-receipt.jpg', contentType: 'image/jpeg', sizeBytes: 640_000, thumbnail: true },
          ],
        })}
        saving={false}
        onSave={noop}
        onCancel={noop}
        attachments={attachments}
      />
    </EditingRow>
  )
}
