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
import { StorageXhr } from './testing/storage'
import { stubApi, type Announced, type Answer, type ApiStub } from './testing/api'
import { ALICE, renderSignedIn } from './testing/board'

/** The backend: echoes a created task with a fresh id, and answers its uploads as `announce` says. */
function backend(options: { announce?: (announced: Announced) => Answer | undefined } = {}) {
  return stubApi({ me: ALICE, echoPost: true, announce: options.announce })
}

const pdf = () => new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' })
const png = () => new File(['png!'], 'photo.png', { type: 'image/png' })

async function openAddRow(fetchMock: ApiStub) {
  await renderSignedIn(fetchMock)
  fireEvent.click(screen.getByRole('button', { name: 'Add a task' }))
  fireEvent.change(screen.getByLabelText('What needs doing'), { target: { value: 'Pay the bill' } })
  return within(document.querySelector('.add-form') as HTMLElement)
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

describe('attaching while adding a task', () => {
  it('holds the chosen files, then uploads them to the task once it exists', async () => {
    const fetchMock = backend()
    const row = await openAddRow(fetchMock)

    fireEvent.change(row.getByLabelText('choose a file'), { target: { files: [pdf(), png()] } })
    expect(row.getByText('scan.pdf')).toBeInTheDocument()
    expect(row.getByText('photo.png')).toBeInTheDocument()
    // Nothing goes up before the task exists.
    expect(StorageXhr.urls).toEqual([])

    fireEvent.click(row.getByRole('button', { name: /^Add$/ }))

    await waitFor(() => expect(StorageXhr.urls).toHaveLength(2))
    const taskRow = (await screen.findByLabelText('Mark "Pay the bill" as done')).closest('li') as HTMLElement
    await waitFor(() => expect(within(taskRow).getByRole('button', { name: 'Open scan.pdf' })).toBeInTheDocument())
    // Everything went, so the add row closes, as the app's form does (#383).
    expect(screen.queryByLabelText('What needs doing')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add a task' })).toHaveFocus()
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

    expect(row.getByText('This task holds the most attachments it can (2).')).toBeInTheDocument()
    expect(row.queryByLabelText('choose a file')).not.toBeInTheDocument()
  })

  it('locks the row while the files go up, and clears its messages when it is closed', async () => {
    let finish: () => void = () => {}
    class SlowXhr extends StorageXhr {
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
    await waitFor(() => expect(screen.queryByLabelText('What needs doing')).not.toBeInTheDocument())

    // Opened again, it says nothing of the last attempt.
    fireEvent.click(screen.getByRole('button', { name: 'Add a task' }))
    expect(screen.queryByText('page.html is neither a PDF nor an image.')).not.toBeInTheDocument()
  })

  it('stays open on Escape while the task is being created, and its files then go up', async () => {
    let created: () => void = () => {}
    const answers = backend()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/api/tasks') && init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          created = () => void answers(input, init).then(resolve)
        })
      }
      return answers(input, init)
    })
    const row = await openAddRow(fetchMock)
    fireEvent.change(row.getByLabelText('choose a file'), { target: { files: [pdf()] } })
    fireEvent.click(row.getByRole('button', { name: /^Add$/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/tasks$/), expect.anything()))
    fireEvent.keyDown(screen.getByLabelText('What needs doing'), { key: 'Escape' })
    expect(screen.getByLabelText('What needs doing')).toBeInTheDocument()

    created()
    await waitFor(() => expect(StorageXhr.urls).toEqual(['https://bucket.example.com/scan.pdf']))
  })

  it('keeps the task when a file is refused after it, and says which and why', async () => {
    const row = await openAddRow(
      backend({ announce: ({ fileName }) => (fileName === 'photo.png' ? { status: 422, body: { refusal: 'USER_FULL' } } : undefined) }),
    )

    fireEvent.change(row.getByLabelText('choose a file'), { target: { files: [pdf(), png()] } })
    fireEvent.click(row.getByRole('button', { name: /^Add$/ }))

    expect(
      await row.findByText('photo.png was not attached: you already have as many attachments as you can. Remove one first.'),
    ).toBeInTheDocument()
    const taskRow = screen.getByLabelText('Mark "Pay the bill" as done').closest('li') as HTMLElement
    await waitFor(() => expect(within(taskRow).getByRole('button', { name: 'Open scan.pdf' })).toBeInTheDocument())
  })
})

describe('closing the add row after Add (#383)', () => {
  it('stays open, cleared, when a file did not make it, so the row can say which', async () => {
    const row = await openAddRow(
      backend({ announce: () => ({ status: 422, body: { refusal: 'USER_FULL' } }) }),
    )

    fireEvent.change(row.getByLabelText('choose a file'), { target: { files: [pdf()] } })
    fireEvent.click(row.getByRole('button', { name: /^Add$/ }))

    expect(
      await row.findByText('scan.pdf was not attached: you already have as many attachments as you can. Remove one first.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('What needs doing')).toHaveValue('')
    await waitFor(() => expect(screen.getByLabelText('What needs doing')).toHaveFocus())
  })

  it('forgets a refusal when closed with Cancel', async () => {
    const row = await openAddRow(backend())
    fireEvent.change(row.getByLabelText('choose a file'), {
      target: { files: [new File(['<p>'], 'page.html', { type: 'text/html' })] },
    })
    expect(row.getByText('page.html is neither a PDF nor an image.')).toBeInTheDocument()

    fireEvent.click(row.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add a task' }))

    expect(screen.queryByText('page.html is neither a PDF nor an image.')).not.toBeInTheDocument()
  })

  it('locks the row while the task is created, so nothing typed then is lost, nor can it be closed', async () => {
    let created: () => void = () => {}
    const answers = backend()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/api/tasks') && init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          created = () => void answers(input, init).then(resolve)
        })
      }
      return answers(input, init)
    })
    const row = await openAddRow(fetchMock)
    fireEvent.click(row.getByRole('button', { name: /^Add$/ }))

    await waitFor(() => expect(screen.getByLabelText('What needs doing')).toBeDisabled())
    expect(row.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    created()
    await waitFor(() => expect(screen.queryByLabelText('What needs doing')).not.toBeInTheDocument())
  })
})

describe('choosing several files in the editor', () => {
  it('refuses those beyond the room the task has, without sending them', async () => {
    const one = { id: 5, fileName: 'first.pdf', contentType: 'application/pdf', sizeBytes: 4, thumbnail: false }
    const fetchMock = stubApi({
      me: ALICE,
      tasks: [{ id: 7, description: 'One left', dueDate: '2099-01-01', importance: 'LOW', state: 'TODO', attachments: [one] }],
      announce: { status: 422, body: { refusal: 'TASK_FULL' } },
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
    expect(await editor.findByText('photo.png was not attached: this task already holds as many attachments as it can.'))
      .toBeInTheDocument()
    const announced = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith('/attachments') && init?.method === 'POST')
    expect(announced).toHaveLength(1)
  })
})

