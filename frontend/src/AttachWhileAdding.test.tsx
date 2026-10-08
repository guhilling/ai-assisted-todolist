/**
 * Attaching files while adding a task (#216): chosen or dropped in the add row, held there until
 * Add, then uploaded to the task once it exists. A file that cannot be attached does not undo the
 * task; the row says which and why.
 *
 * Against a stubbed `fetch` and `XMLHttpRequest`, like Attachments.test.tsx.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const CREATED_ID = 41

function json(value: unknown, status = 200) {
  return Promise.resolve(new Response(value === null ? null : JSON.stringify(value), { status }))
}

/** The backend: echoes a created task with a fresh id, and answers its uploads as `announce` says. */
function backend(options: { announce?: (fileName: string) => { status: number; body: unknown } | undefined } = {}) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.includes('/api/auth/me')) {
      return json({ email: 'alice@example.com' })
    }
    if (url.includes('/api/auth/providers')) {
      return json({ enabled: true, providers: [] })
    }
    if (url.endsWith(`/api/tasks/${CREATED_ID}/attachments`) && method === 'POST') {
      const { fileName, contentType, sizeBytes } = JSON.parse(String(init?.body))
      const answer = options.announce?.(fileName)
      if (answer) {
        return json(answer.body, answer.status)
      }
      const attachment = { id: fileName.length, fileName, contentType, sizeBytes }
      return json({ attachment, url: `https://bucket.example.com/${fileName}`, headers: {}, expiresAt: '2026-10-08T10:15:30Z' }, 201)
    }
    if (url.includes('/confirm')) {
      const id = Number(url.split('/').at(-2))
      const name = id === 'scan.pdf'.length ? 'scan.pdf' : 'photo.png'
      return json({ id, fileName: name, contentType: name.endsWith('pdf') ? 'application/pdf' : 'image/png', sizeBytes: 4 })
    }
    if (url.endsWith('/link')) {
      return json({ url: 'https://bucket.example.com/preview', expiresAt: '2026-10-08T10:15:30Z' })
    }
    if (url.endsWith('/api/tasks') && method === 'POST') {
      return json({ ...JSON.parse(String(init?.body)), id: CREATED_ID, attachments: [] }, 201)
    }
    if (url.endsWith('/api/tasks')) {
      return json([])
    }
    return json(null, 404)
  })
}

/** Storage: takes every PUT. */
class FakeXhr {
  static sent: string[] = []
  status = 0
  upload = { onprogress: null as ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  private url = ''
  open(_method: string, url: string) {
    this.url = url
  }
  setRequestHeader() {}
  send() {
    FakeXhr.sent.push(this.url)
    this.status = 200
    this.onload?.()
  }
}

const pdf = () => new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' })
const png = () => new File(['png!'], 'photo.png', { type: 'image/png' })

async function openAddRow(fetchMock: ReturnType<typeof backend>) {
  globalThis.fetch = fetchMock as unknown as typeof fetch
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Add a task' }))
  fireEvent.change(screen.getByLabelText('What needs doing'), { target: { value: 'Pay the bill' } })
  return within(document.querySelector('.add-form') as HTMLElement)
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
  FakeXhr.sent = []
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('attaching while adding a task', () => {
  it('holds the chosen files, then uploads them to the task once it exists', async () => {
    const fetchMock = backend()
    const row = await openAddRow(fetchMock)

    fireEvent.change(row.getByLabelText('choose a file'), { target: { files: [pdf(), png()] } })
    expect(row.getByText('scan.pdf')).toBeInTheDocument()
    expect(row.getByText('photo.png')).toBeInTheDocument()
    // Nothing goes up before the task exists.
    expect(FakeXhr.sent).toEqual([])

    fireEvent.click(row.getByRole('button', { name: /^Add$/ }))

    await waitFor(() => expect(FakeXhr.sent).toHaveLength(2))
    const taskRow = (await screen.findByLabelText('Mark "Pay the bill" as done')).closest('li') as HTMLElement
    await waitFor(() => expect(within(taskRow).getByRole('button', { name: 'Open scan.pdf' })).toBeInTheDocument())
    // Everything went, so the add row is clear for the next task.
    expect(screen.getByLabelText('What needs doing')).toHaveValue('')
    expect(row.queryByText('scan.pdf')).not.toBeInTheDocument()
  })

  it('lets a held file be dropped again before Add', async () => {
    const row = await openAddRow(backend())

    fireEvent.change(row.getByLabelText('choose a file'), { target: { files: [pdf()] } })
    fireEvent.click(row.getByRole('button', { name: 'Remove scan.pdf' }))

    expect(row.queryByText('scan.pdf')).not.toBeInTheDocument()
  })

  it('refuses a file of another type at once, without holding it', async () => {
    const row = await openAddRow(backend())

    fireEvent.change(row.getByLabelText('choose a file'), {
      target: { files: [new File(['<p>'], 'page.html', { type: 'text/html' })] },
    })

    expect(row.getByText('page.html is neither a PDF nor an image.')).toBeInTheDocument()
    expect(row.queryByRole('button', { name: 'Remove page.html' })).not.toBeInTheDocument()
  })

  it('holds no more files than a task may have', async () => {
    const row = await openAddRow(backend())

    fireEvent.change(row.getByLabelText('choose a file'), { target: { files: [pdf(), png()] } })

    expect(row.getByText('This task holds the most files it can (2).')).toBeInTheDocument()
    expect(row.queryByLabelText('choose a file')).not.toBeInTheDocument()
  })

  it('keeps the task when a file is refused after it, and says which and why', async () => {
    const row = await openAddRow(
      backend({ announce: (fileName) => (fileName === 'photo.png' ? { status: 422, body: { refusal: 'USER_FULL' } } : undefined) }),
    )

    fireEvent.change(row.getByLabelText('choose a file'), { target: { files: [pdf(), png()] } })
    fireEvent.click(row.getByRole('button', { name: /^Add$/ }))

    expect(
      await row.findByText('photo.png was not attached: you already have as many files as you can. Remove one first.'),
    ).toBeInTheDocument()
    const taskRow = screen.getByLabelText('Mark "Pay the bill" as done').closest('li') as HTMLElement
    await waitFor(() => expect(within(taskRow).getByRole('button', { name: 'Open scan.pdf' })).toBeInTheDocument())
  })
})
