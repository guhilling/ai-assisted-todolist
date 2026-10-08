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

  it('locks the row while the files go up, and clears its messages when it is closed', async () => {
    let finish: () => void = () => {}
    class SlowXhr extends FakeXhr {
      send() {
        finish = () => {
          this.status = 200
          this.onload?.()
        }
      }
    }
    vi.stubGlobal('XMLHttpRequest', SlowXhr)
    const row = await openAddRow(backend())
    fireEvent.change(row.getByLabelText('choose a file'), {
      target: { files: [pdf(), new File(['<p>'], 'page.html', { type: 'text/html' })] },
    })
    expect(row.getByText('page.html is neither a PDF nor an image.')).toBeInTheDocument()

    fireEvent.click(row.getByRole('button', { name: /^Add$/ }))

    // While the file goes up, nothing in the row can change: typing or dropping would be lost.
    await waitFor(() => expect(screen.getByLabelText('What needs doing')).toBeDisabled())
    expect(row.getByRole('button', { name: 'Remove scan.pdf' })).toBeDisabled()
    fireEvent.keyDown(screen.getByLabelText('What needs doing'), { key: 'Escape' })
    expect(screen.getByLabelText('What needs doing')).toBeInTheDocument()

    finish()
    await waitFor(() => expect(screen.getByLabelText('What needs doing')).toBeEnabled())

    // Closing forgets what was said about the last attempt.
    fireEvent.click(row.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add a task' }))
    expect(screen.queryByText('page.html is neither a PDF nor an image.')).not.toBeInTheDocument()
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

describe('choosing several files in the editor', () => {
  it('refuses those beyond the room the task has, without sending them', async () => {
    const one = { id: 5, fileName: 'first.pdf', contentType: 'application/pdf', sizeBytes: 4 }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/auth/me')) return json({ email: 'alice@example.com' })
      if (url.includes('/api/auth/providers')) return json({ enabled: true, providers: [] })
      if (url.endsWith('/link')) return json({ url: 'https://bucket.example.com/x', expiresAt: '2026-10-08T10:15:30Z' })
      if (url.endsWith('/attachments') && init?.method === 'POST') return json({ refusal: 'TASK_FULL' }, 422)
      if (url.endsWith('/api/tasks')) {
        return json([{ id: 7, description: 'One left', dueDate: '2099-01-01', importance: 'LOW', state: 'TODO', attachments: [one] }])
      }
      return json(null, 404)
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    render(<App />)
    const label = await screen.findByLabelText('Mark "One left" as done')
    const taskRow = within(label.closest('li') as HTMLElement)
    fireEvent.click(taskRow.getByLabelText('Actions for "One left"'))
    fireEvent.click(taskRow.getByRole('button', { name: 'Edit' }))
    const editor = within(screen.getByRole('form', { name: 'Edit "One left"' }))

    fireEvent.change(editor.getByLabelText('choose a file'), { target: { files: [pdf(), png()] } })

    // Room for one: the second is refused here, and only the first is announced.
    expect(await editor.findByText('photo.png was not attached: this task already holds as many files as it can.'))
      .toBeInTheDocument()
    const announced = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith('/attachments') && init?.method === 'POST')
    expect(announced).toHaveLength(1)
  })
})

