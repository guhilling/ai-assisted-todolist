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
import App from './App'
import TaskRow from './components/TaskRow'
import { addDays, todayIso } from './dates'
import { de, en } from './i18n/messages'

const PDF = { id: 7, fileName: 'Rechnung.pdf', contentType: 'application/pdf', sizeBytes: 48213 }
const PHOTO = { id: 8, fileName: 'Quittung.jpg', contentType: 'image/jpeg', sizeBytes: 90000 }

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    description: 'Pay the invoice',
    dueDate: addDays(todayIso(), 1),
    importance: 'MEDIUM',
    state: 'TODO',
    attachments: [],
    ...overrides,
  }
}

function json(value: unknown, status = 200) {
  return Promise.resolve(new Response(value === null ? null : JSON.stringify(value), { status }))
}

/** The backend, by method and path; `announce` and `confirm` decide how an upload goes. */
function mockBackend(options: {
  tasks: unknown[]
  /** How a link request is answered; the default is a working link. */
  linkStatus?: number
  announce?: { status: number; body: unknown }
  confirm?: { status: number; body: unknown }
  remove?: number
}) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.includes('/api/auth/me')) {
      return json({ email: 'alice@example.com' })
    }
    if (url.includes('/api/auth/providers')) {
      return json({ enabled: true, providers: [] })
    }
    const link = url.match(/\/attachments\/(\d+)\/link$/)
    if (link && options.linkStatus) {
      return json(null, options.linkStatus)
    }
    if (link) {
      return json({ url: `https://bucket.example.com/object-${link[1]}`, expiresAt: '2026-10-08T10:15:30Z' })
    }
    if (url.endsWith('/confirm')) {
      return json(options.confirm?.body ?? null, options.confirm?.status ?? 200)
    }
    if (url.match(/\/attachments\/\d+$/) && method === 'DELETE') {
      return json(null, options.remove ?? 204)
    }
    if (url.endsWith('/attachments') && method === 'POST') {
      return json(options.announce?.body ?? null, options.announce?.status ?? 201)
    }
    if (url.endsWith('/api/tasks')) {
      return json(options.tasks)
    }
    return json(null, 404)
  })
}

/** Storage's side of an upload: reports half the file sent, then answers 200. */
class FakeXhr {
  static sent: unknown[] = []
  status = 0
  upload = { onprogress: null as ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  open() {}
  setRequestHeader() {}
  send(body: unknown) {
    FakeXhr.sent.push(body)
    this.upload.onprogress?.({ loaded: 1, total: 2, lengthComputable: true })
    this.status = 200
    this.onload?.()
  }
}

async function renderBoard(fetchMock: ReturnType<typeof mockBackend>) {
  globalThis.fetch = fetchMock as unknown as typeof fetch
  render(<App />)
  await waitFor(() => expect(screen.getByRole('button', { name: /add a task/i })).toBeInTheDocument())
}

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
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
  FakeXhr.sent = []
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('on the row', () => {
  it('lists a PDF by name and shows an image inline', async () => {
    await renderBoard(mockBackend({ tasks: [task({ attachments: [PDF, PHOTO] })] }))

    const row = rowFor('Pay the invoice')
    expect(row.getByRole('button', { name: 'Open Rechnung.pdf' })).toHaveTextContent('Rechnung.pdf')
    await waitFor(() =>
      expect(row.getByRole('img', { name: 'Quittung.jpg' })).toHaveAttribute('src', 'https://bucket.example.com/object-8'),
    )
  })

  it('opens a file in a new tab through a link asked for on the click', async () => {
    await renderBoard(mockBackend({ tasks: [task({ attachments: [PDF] })] }))
    const tab = { location: { href: '' }, opener: {} as unknown, close: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)

    fireEvent.click(rowFor('Pay the invoice').getByRole('button', { name: 'Open Rechnung.pdf' }))

    // The tab is opened on the click itself, so a popup blocker allows it; the link follows.
    expect(open).toHaveBeenCalledWith('', '_blank')
    await waitFor(() => expect(tab.location.href).toBe('https://bucket.example.com/object-7'))
    expect(tab.opener).toBeNull()
  })

  it('removes a file', async () => {
    const backend = mockBackend({ tasks: [task({ attachments: [PDF] })] })
    await renderBoard(backend)

    fireEvent.click(rowFor('Pay the invoice').getByRole('button', { name: 'Remove Rechnung.pdf' }))

    await waitFor(() => expect(screen.queryByText('Rechnung.pdf')).not.toBeInTheDocument())
    expect(backend).toHaveBeenCalledWith('/api/tasks/1/attachments/7', expect.objectContaining({ method: 'DELETE' }))
  })

  it('keeps a file whose removal failed, and says so', async () => {
    await renderBoard(mockBackend({ tasks: [task({ attachments: [PDF] })], remove: 500 }))

    fireEvent.click(rowFor('Pay the invoice').getByRole('button', { name: 'Remove Rechnung.pdf' }))

    expect(await screen.findByText('Unable to remove the file.')).toBeInTheDocument()
    expect(rowFor('Pay the invoice').getByText('Rechnung.pdf')).toBeInTheDocument()
  })

  it('lets a completed task be opened but not changed', async () => {
    await renderBoard(mockBackend({ tasks: [task({ state: 'DONE', attachments: [PDF] })] }))

    expect(rowFor('Pay the invoice').getByRole('button', { name: 'Open Rechnung.pdf' })).toBeInTheDocument()
    expect(rowFor('Pay the invoice').queryByRole('button', { name: 'Remove Rechnung.pdf' })).not.toBeInTheDocument()
  })
})

describe('when something goes wrong', () => {
  it('closes the tab again and says so when a file cannot be opened', async () => {
    await renderBoard(mockBackend({ tasks: [task({ attachments: [PDF] })], linkStatus: 500 }))
    const tab = { location: { href: '' }, opener: {} as unknown, close: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)

    fireEvent.click(rowFor('Pay the invoice').getByRole('button', { name: 'Open Rechnung.pdf' }))

    expect(await screen.findByText('Unable to open the file.')).toBeInTheDocument()
    expect(tab.close).toHaveBeenCalled()
  })

  it('does nothing more when the browser blocked the tab', async () => {
    await renderBoard(mockBackend({ tasks: [task({ attachments: [PDF] })] }))
    const open = vi.spyOn(window, 'open').mockReturnValue(null)

    fireEvent.click(rowFor('Pay the invoice').getByRole('button', { name: 'Open Rechnung.pdf' }))

    await waitFor(() => expect(open).toHaveBeenCalled())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps an image whose preview could not be had as a box that still opens it', async () => {
    await renderBoard(mockBackend({ tasks: [task({ attachments: [PHOTO] })], linkStatus: 500 }))

    const open = rowFor('Pay the invoice').getByRole('button', { name: 'Open Quittung.jpg' })

    await waitFor(() => expect(open.querySelector('.attachment-preview--loading')).not.toBeNull())
    expect(rowFor('Pay the invoice').queryByRole('img')).not.toBeInTheDocument()
  })

  it('signs the board out when the session ends during an upload', async () => {
    await renderBoard(mockBackend({ tasks: [task()], announce: { status: 401, body: null } }))
    const editor = openEditor('Pay the invoice')

    fireEvent.change(editor.getByLabelText('choose a file'), { target: { files: [pdfFile()] } })

    expect(await screen.findByText('Your session has expired. Sign in again to carry on.')).toBeInTheDocument()
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
    await renderBoard(mockBackend({ tasks: [task()] }))
    const editor = openEditor('Pay the invoice')
    const zone = editor.getByText('Drop a PDF or image here, or').closest('div') as HTMLElement

    fireEvent.dragOver(zone)
    expect(zone).toHaveClass('attachment-drop--active')

    fireEvent.dragLeave(zone)
    expect(zone).not.toHaveClass('attachment-drop--active')
  })

  it('says the limits before anything is chosen', async () => {
    await renderBoard(mockBackend({ tasks: [task()] }))

    const editor = openEditor('Pay the invoice')

    expect(editor.getByText('PDF or image, up to 10 MB · 2 per task, 5 in all')).toBeInTheDocument()
  })

  it('uploads a chosen file and lists it on the row', async () => {
    const scan = { id: 9, fileName: 'Scan.pdf', contentType: 'application/pdf', sizeBytes: 4 }
    await renderBoard(
      mockBackend({
        tasks: [task()],
        announce: { status: 201, body: { attachment: scan, url: 'https://bucket.example.com/put', headers: {}, expiresAt: '2026-10-08T10:15:30Z' } },
        confirm: { status: 200, body: scan },
      }),
    )
    const editor = openEditor('Pay the invoice')
    const file = pdfFile()

    fireEvent.change(editor.getByLabelText('choose a file'), { target: { files: [file] } })

    await waitFor(() => expect(editor.getByRole('button', { name: 'Remove Scan.pdf' })).toBeInTheDocument())
    expect(FakeXhr.sent).toEqual([file])
    fireEvent.click(editor.getByRole('button', { name: 'Cancel' }))
    expect(rowFor('Pay the invoice').getByRole('button', { name: 'Open Scan.pdf' })).toBeInTheDocument()
  })

  it('uploads a dropped file', async () => {
    const scan = { id: 9, fileName: 'Scan.pdf', contentType: 'application/pdf', sizeBytes: 4 }
    await renderBoard(
      mockBackend({
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
    await renderBoard(mockBackend({ tasks: [task()], announce: { status: 422, body: { refusal: 'USER_FULL' } } }))
    const editor = openEditor('Pay the invoice')

    fireEvent.change(editor.getByLabelText('choose a file'), { target: { files: [pdfFile()] } })

    expect(
      await editor.findByText('Scan.pdf was not attached: you already have as many files as you can. Remove one first.'),
    ).toBeInTheDocument()
  })

  it('refuses a file of another type without uploading it', async () => {
    const backend = mockBackend({ tasks: [task()] })
    await renderBoard(backend)
    const editor = openEditor('Pay the invoice')

    fireEvent.change(editor.getByLabelText('choose a file'), {
      target: { files: [new File(['<p>'], 'page.html', { type: 'text/html' })] },
    })

    expect(await editor.findByText('page.html is neither a PDF nor an image.')).toBeInTheDocument()
    expect(backend).not.toHaveBeenCalledWith('/api/tasks/1/attachments', expect.anything())
  })

  it('says an upload failed', async () => {
    await renderBoard(mockBackend({ tasks: [task()], announce: { status: 500, body: null } }))
    const editor = openEditor('Pay the invoice')

    fireEvent.change(editor.getByLabelText('choose a file'), { target: { files: [pdfFile()] } })

    expect(await editor.findByText('Scan.pdf could not be uploaded. Try again.')).toBeInTheDocument()
  })

  it('offers no more files once a task holds as many as it can', async () => {
    await renderBoard(mockBackend({ tasks: [task({ attachments: [PDF, PHOTO] })] }))

    const editor = openEditor('Pay the invoice')

    expect(editor.getByText('This task holds the most files it can (2).')).toBeInTheDocument()
    expect(editor.queryByLabelText('choose a file')).not.toBeInTheDocument()
  })

  it('shows how far an upload has got', async () => {
    let finish: () => void = () => {}
    class SlowXhr extends FakeXhr {
      send() {
        this.upload.onprogress?.({ loaded: 1, total: 4, lengthComputable: true })
        finish = () => {
          this.status = 200
          this.onload?.()
        }
      }
    }
    vi.stubGlobal('XMLHttpRequest', SlowXhr)
    const scan = { id: 9, fileName: 'Scan.pdf', contentType: 'application/pdf', sizeBytes: 4 }
    await renderBoard(
      mockBackend({
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
          onSetState={() => {}}
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
