/**
 * Files on tasks (#204), as the board shows them: listed, opened and removed on the row, images
 * inline; attached in the editor by choosing or dropping, with the limits said first, progress,
 * and the reason when one is refused.
 *
 * Against a stubbed `fetch` and `XMLHttpRequest`, like the board's own tests; whether storage
 * really accepts the upload is the browser suites' and the backend's business.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TaskRow from './components/TaskRow'
import { todayIso } from './dates'
import { de, en } from './i18n/messages'
import { StorageXhr } from './testing/storage'
import { stubApi } from './testing/api'
import { ALICE, isoIn, renderSignedIn } from './testing/board'

const PDF = { id: 7, fileName: 'Rechnung.pdf', contentType: 'application/pdf', sizeBytes: 48213, thumbnail: false }
const PHOTO = { id: 8, fileName: 'Quittung.jpg', contentType: 'image/jpeg', sizeBytes: 90000, thumbnail: false }

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    description: 'Pay the invoice',
    dueDate: isoIn(1),
    importance: 'MEDIUM',
    state: 'TODO',
    attachments: [],
    ...overrides,
  }
}


/** The row's queries, so a file's controls can be addressed unambiguously. */
function rowFor(description: string) {
  return within(screen.getByLabelText(`Mark "${description}" as done`).closest('li') as HTMLElement)
}

function openEditor(description: string) {
  fireEvent.click(rowFor(description).getByLabelText(`Actions for "${description}"`))
  fireEvent.click(rowFor(description).getByRole('button', { name: 'Edit' }))
  return within(screen.getByRole('form', { name: `Edit "${description}"` }))
}

function pdfFile(name = 'Scan.pdf') {
  return new File(['%PDF'], name, { type: 'application/pdf' })
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal('XMLHttpRequest', StorageXhr)
  StorageXhr.urls = []
  StorageXhr.bodies = []
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('on the row', () => {
  it('lists a PDF by name and shows an image inline', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ attachments: [PDF, PHOTO] })] }))

    const row = rowFor('Pay the invoice')
    expect(row.getByRole('button', { name: 'Open Rechnung.pdf' })).toHaveTextContent('Rechnung.pdf')
    await waitFor(() =>
      expect(row.getByRole('img', { name: 'Quittung.jpg' })).toHaveAttribute('src', 'https://bucket.example.com/object-8'),
    )
  })

  it('opens a large preview of a file through a link asked for on the click', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ attachments: [PDF, PHOTO] })] }))

    fireEvent.click(rowFor('Pay the invoice').getByRole('button', { name: 'Open Quittung.jpg' }))

    const photo = await screen.findByRole('dialog', { name: 'Quittung.jpg' })
    expect(within(photo).getByRole('img', { name: 'Quittung.jpg' })).toHaveAttribute(
      'src',
      'https://bucket.example.com/object-8',
    )
    fireEvent.click(within(photo).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // jsdom has no PDF viewer, as a phone's browser has none: the preview offers a tab instead.
    fireEvent.click(rowFor('Pay the invoice').getByRole('button', { name: 'Open Rechnung.pdf' }))
    const pdf = await screen.findByRole('dialog', { name: 'Rechnung.pdf' })
    expect(within(pdf).getByRole('link', { name: 'Open in a new tab' })).toHaveAttribute(
      'href',
      'https://bucket.example.com/object-7',
    )
  })

  it('shows the file opened last, whichever link answers first', async () => {
    const backend = stubApi({ me: ALICE, tasks: [task({ attachments: [PDF, PHOTO] })] })
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    const slowPdf = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/attachments/7/link') ? held.then(() => backend(input, init)) : backend(input, init),
    )
    await renderSignedIn(slowPdf)

    fireEvent.click(rowFor('Pay the invoice').getByRole('button', { name: 'Open Rechnung.pdf' }))
    fireEvent.click(rowFor('Pay the invoice').getByRole('button', { name: 'Open Quittung.jpg' }))
    await screen.findByRole('dialog', { name: 'Quittung.jpg' })
    await act(async () => release())

    expect(screen.getByRole('dialog', { name: 'Quittung.jpg' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Rechnung.pdf' })).not.toBeInTheDocument()
  })

  it('keeps the board out of reach of the keyboard while a preview is open, and gives the focus back', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ attachments: [PHOTO] })] }))
    const open = rowFor('Pay the invoice').getByRole('button', { name: 'Open Quittung.jpg' })
    open.focus()
    fireEvent.click(open)
    const preview = await screen.findByRole('dialog', { name: 'Quittung.jpg' })

    // The board's own shortcut for a new task must not act behind the preview.
    fireEvent.keyDown(within(preview).getByRole('button', { name: 'Close' }), { key: 'n' })
    expect(screen.queryByLabelText('What needs doing')).not.toBeInTheDocument()

    fireEvent.click(within(preview).getByRole('button', { name: 'Close' }))
    expect(open).toHaveFocus()
  })

  it('removes a file', async () => {
    const backend = stubApi({ me: ALICE, tasks: [task({ attachments: [PDF] })] })
    await renderSignedIn(backend)

    fireEvent.click(rowFor('Pay the invoice').getByRole('button', { name: 'Remove Rechnung.pdf' }))

    await waitFor(() => expect(screen.queryByText('Rechnung.pdf')).not.toBeInTheDocument())
    expect(backend).toHaveBeenCalledWith('/api/tasks/1/attachments/7', expect.objectContaining({ method: 'DELETE' }))
  })

  it('keeps a file whose removal failed, and says so', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ attachments: [PDF] })], remove: 500 }))

    fireEvent.click(rowFor('Pay the invoice').getByRole('button', { name: 'Remove Rechnung.pdf' }))

    expect(await screen.findByText('Unable to remove the file.')).toBeInTheDocument()
    expect(rowFor('Pay the invoice').getByText('Rechnung.pdf')).toBeInTheDocument()
  })

  it('lets a completed task be opened but not changed', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ state: 'DONE', attachments: [PDF] })] }))

    expect(rowFor('Pay the invoice').getByRole('button', { name: 'Open Rechnung.pdf' })).toBeInTheDocument()
    expect(rowFor('Pay the invoice').queryByRole('button', { name: 'Remove Rechnung.pdf' })).not.toBeInTheDocument()
  })
})

describe('when something goes wrong', () => {
  it('shows no preview and says so when a file cannot be opened', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ attachments: [PDF] })], link: { status: 500 } }))

    fireEvent.click(rowFor('Pay the invoice').getByRole('button', { name: 'Open Rechnung.pdf' }))

    expect(await screen.findByText('Unable to open the file.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps an image whose preview could not be had as a box that still opens it', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ attachments: [PHOTO] })], link: { status: 500 } }))

    const open = rowFor('Pay the invoice').getByRole('button', { name: 'Open Quittung.jpg' })

    await waitFor(() => expect(open.querySelector('.attachment-preview--loading')).not.toBeNull())
    expect(rowFor('Pay the invoice').queryByRole('img')).not.toBeInTheDocument()
  })

  it('signs the board out when the session ends during an upload', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task()], announce: { status: 401, body: null } }))
    const editor = openEditor('Pay the invoice')

    fireEvent.change(editor.getByLabelText('choose a file'), { target: { files: [pdfFile()] } })

    expect(await screen.findByText('Your session has expired. Sign in again to carry on.')).toBeInTheDocument()
  })
})

describe('a session that ends while a preview is open', () => {
  it('signs the board out when Download finds the session gone, rather than calling it a failed download', async () => {
    const backend = stubApi({ me: ALICE, tasks: [task({ attachments: [PHOTO] })] })
    let links = 0
    // The row's small preview and the large one get their links; the fresh one Download asks for
    // finds the session ended.
    const endsLater = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/attachments/8/link') && ++links > 2
        ? Promise.resolve(new Response(null, { status: 401 }))
        : backend(input, init),
    )
    await renderSignedIn(endsLater)
    fireEvent.click(rowFor('Pay the invoice').getByRole('button', { name: 'Open Quittung.jpg' }))
    const preview = await screen.findByRole('dialog', { name: 'Quittung.jpg' })

    fireEvent.click(within(preview).getByRole('button', { name: 'Download' }))

    expect(await screen.findByText('Your session has expired. Sign in again to carry on.')).toBeInTheDocument()
    expect(screen.queryByText('Quittung.jpg could not be downloaded. Try again.')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('the refusals', () => {
  it('name the file, for every reason, in every language', () => {
    for (const catalogue of [en, de]) {
      for (const word of Object.values(catalogue.attachments.refusals)) {
        expect(word('Scan.pdf')).toContain('Scan.pdf')
      }
    }
  })
})

describe('in the editor', () => {
  it('shows where a file being dragged will land', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task()] }))
    const editor = openEditor('Pay the invoice')
    const zone = editor.getByText('Drop a PDF or image here, or').closest('div') as HTMLElement

    fireEvent.dragOver(zone)
    expect(zone).toHaveClass('attachment-drop--active')

    fireEvent.dragLeave(zone)
    expect(zone).not.toHaveClass('attachment-drop--active')
  })

  it('says the limits before anything is chosen', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task()] }))

    const editor = openEditor('Pay the invoice')

    expect(editor.getByText('PDF or image, up to 10 MB · 2 per task, 5 in all')).toBeInTheDocument()
  })

  it('uploads a chosen file and lists it on the row', async () => {
    const scan = { id: 9, fileName: 'Scan.pdf', contentType: 'application/pdf', sizeBytes: 4, thumbnail: false }
    await renderSignedIn(
      stubApi({
        me: ALICE,
        tasks: [task()],
        announce: { status: 201, body: { attachment: scan, url: 'https://bucket.example.com/put', headers: {}, expiresAt: '2026-10-08T10:15:30Z' } },
        confirm: { status: 200, body: scan },
      }),
    )
    const editor = openEditor('Pay the invoice')
    const file = pdfFile()

    fireEvent.change(editor.getByLabelText('choose a file'), { target: { files: [file] } })

    await waitFor(() => expect(editor.getByRole('button', { name: 'Remove Scan.pdf' })).toBeInTheDocument())
    expect(StorageXhr.bodies).toEqual([file])
    fireEvent.click(editor.getByRole('button', { name: 'Cancel' }))
    expect(rowFor('Pay the invoice').getByRole('button', { name: 'Open Scan.pdf' })).toBeInTheDocument()
  })

  it('uploads a dropped file', async () => {
    const scan = { id: 9, fileName: 'Scan.pdf', contentType: 'application/pdf', sizeBytes: 4, thumbnail: false }
    await renderSignedIn(
      stubApi({
        me: ALICE,
        tasks: [task()],
        announce: { status: 201, body: { attachment: scan, url: 'https://bucket.example.com/put', headers: {}, expiresAt: '2026-10-08T10:15:30Z' } },
        confirm: { status: 200, body: scan },
      }),
    )
    const editor = openEditor('Pay the invoice')

    fireEvent.drop(editor.getByText('Drop a PDF or image here, or').closest('div') as HTMLElement, {
      dataTransfer: { files: [pdfFile()] },
    })

    await waitFor(() => expect(editor.getByRole('button', { name: 'Remove Scan.pdf' })).toBeInTheDocument())
  })

  it('says why a file was refused', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task()], announce: { status: 422, body: { refusal: 'USER_FULL' } } }))
    const editor = openEditor('Pay the invoice')

    fireEvent.change(editor.getByLabelText('choose a file'), { target: { files: [pdfFile()] } })

    expect(
      await editor.findByText('Scan.pdf was not attached: you already have as many attachments as you can. Remove one first.'),
    ).toBeInTheDocument()
  })

  it('refuses a file of another type without uploading it', async () => {
    const backend = stubApi({ me: ALICE, tasks: [task()] })
    await renderSignedIn(backend)
    const editor = openEditor('Pay the invoice')

    fireEvent.change(editor.getByLabelText('choose a file'), {
      target: { files: [new File(['<p>'], 'page.html', { type: 'text/html' })] },
    })

    expect(await editor.findByText('page.html is neither a PDF nor an image.')).toBeInTheDocument()
    expect(backend).not.toHaveBeenCalledWith('/api/tasks/1/attachments', expect.anything())
  })

  it('says an upload failed', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task()], announce: { status: 500, body: null } }))
    const editor = openEditor('Pay the invoice')

    fireEvent.change(editor.getByLabelText('choose a file'), { target: { files: [pdfFile()] } })

    expect(await editor.findByText('Scan.pdf could not be uploaded. Try again.')).toBeInTheDocument()
  })

  it('offers no more files once a task holds as many as it can', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ attachments: [PDF, PHOTO] })] }))

    const editor = openEditor('Pay the invoice')

    expect(editor.getByText('This task holds the most attachments it can (2).')).toBeInTheDocument()
    expect(editor.queryByLabelText('choose a file')).not.toBeInTheDocument()
  })

  it('shows how far an upload has got', async () => {
    let finish: () => void = () => {}
    class SlowXhr extends StorageXhr {
      send() {
        this.upload.onprogress?.({ loaded: 1, total: 4, lengthComputable: true })
        finish = () => {
          this.status = 200
          this.onload?.()
        }
      }
    }
    vi.stubGlobal('XMLHttpRequest', SlowXhr)
    const scan = { id: 9, fileName: 'Scan.pdf', contentType: 'application/pdf', sizeBytes: 4, thumbnail: false }
    await renderSignedIn(
      stubApi({
        me: ALICE,
        tasks: [task()],
        announce: { status: 201, body: { attachment: scan, url: 'https://bucket.example.com/put', headers: {}, expiresAt: '2026-10-08T10:15:30Z' } },
        confirm: { status: 200, body: scan },
      }),
    )
    const editor = openEditor('Pay the invoice')

    fireEvent.change(editor.getByLabelText('choose a file'), { target: { files: [pdfFile()] } })

    const progress = await editor.findByRole('progressbar', { name: 'Uploading Scan.pdf' })
    expect(progress).toHaveAttribute('value', '0.25')
    await act(async () => finish())
    await waitFor(() => expect(editor.queryByRole('progressbar')).not.toBeInTheDocument())
  })
})

describe('without attachment actions', () => {
  it('shows a row and its editor as they were before attachments, as the design system does', () => {
    const plain = { ...task({ attachments: [PDF] }), importance: 'MEDIUM' as const, state: 'TODO' as const }
    render(
      <ul>
        <TaskRow
          task={plain}
          today={todayIso()}
          onToggleDone={() => {}}
          onDelete={() => {}}
          onEdit={() => Promise.resolve(true)}
        />
      </ul>,
    )

    expect(screen.queryByText('Rechnung.pdf')).not.toBeInTheDocument()
    const editor = openEditor('Pay the invoice')
    expect(editor.queryByText('Attachments')).not.toBeInTheDocument()
  })
})
