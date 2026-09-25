/**
 * Characterization tests for the app shell, run against a stubbed `fetch`.
 *
 * They cover what the user sees in each state -- signed out, signed in with tasks, and a
 * failed load -- without a backend. Anything that depends on a real session or real
 * persistence is covered by the Playwright suite under /e2e instead.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import App from './App'

function mockFetch(routes: Record<string, unknown>) {
  return vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const match = Object.keys(routes).find((path) => url.includes(path))
    if (!match) {
      return Promise.resolve(new Response(null, { status: 404 }))
    }
    const value = routes[match]
    if (value === 'error') {
      return Promise.resolve(new Response(null, { status: 401 }))
    }
    return Promise.resolve(new Response(JSON.stringify(value), { status: 200 }))
  })
}

/** A 200 carrying `value`, or a 401 for the sentinel `'error'`, matching `mockFetch` above. */
function respond(value: unknown, status = 200) {
  if (value === 'error') {
    return Promise.resolve(new Response(null, { status: 401 }))
  }
  return Promise.resolve(new Response(JSON.stringify(value), { status }))
}

/**
 * A stub that answers by method as well as by path, which `mockFetch` above does not.
 *
 * The mutating paths all live behind POST and PUT to the same `/api/tasks` URL, so telling
 * a create from a list needs the method. Kept separate from `mockFetch` rather than folded
 * into it so the tests written against that one keep the setup they were written with.
 */
function mockApi(options: {
  me?: unknown
  providers?: unknown
  tasks?: unknown
  post?: { status: number; body?: unknown }
  put?: { status: number; body?: unknown }
}) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = init?.method ?? 'GET'

    if (url.includes('/api/auth/me')) {
      return respond(options.me ?? 'error')
    }
    if (url.includes('/api/auth/providers')) {
      return respond(options.providers ?? { enabled: true, providers: [] })
    }
    if (url.includes('/api/tasks')) {
      if (method === 'POST') {
        return respond(options.post?.body ?? null, options.post?.status ?? 201)
      }
      if (method === 'PUT') {
        return respond(options.put?.body ?? null, options.put?.status ?? 200)
      }
      return respond(options.tasks ?? [])
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
}

const ALICE = { email: 'alice@example.com' }

/** Waits for the signed-in view, which every task test starts from. */
async function renderSignedIn(fetchMock: ReturnType<typeof mockApi>) {
  globalThis.fetch = fetchMock as unknown as typeof fetch
  render(<App />)
  await waitFor(() => expect(screen.getByText(/current tasks/i)).toBeInTheDocument())
}

function bodyOf(fetchMock: ReturnType<typeof mockApi>, method: string) {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === method)
  return JSON.parse(String(call?.[1]?.body))
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('App', () => {
  it('shows a sign-in prompt and no task board when not authenticated', async () => {
    globalThis.fetch = mockFetch({
      '/api/auth/me': 'error',
      '/api/auth/providers': {
        enabled: true,
        providers: [
          { id: 'google', label: 'Google', available: true, loginUrl: '/api/auth/login', issuer: 'https://accounts.google.com' },
        ],
      },
    }) as unknown as typeof fetch

    render(<App />)

    await waitFor(() => expect(screen.getByText('Please sign in to continue.')).toBeInTheDocument())
    expect(screen.queryByText(/current tasks/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /continue with google/i })).toHaveAttribute(
      'href',
      expect.stringContaining('/api/auth/login'),
    )
  })

  it('shows the task board with the new task fields when authenticated', async () => {
    globalThis.fetch = mockFetch({
      '/api/auth/me': { email: 'alice@example.com' },
      '/api/auth/providers': { enabled: true, providers: [] },
      '/api/tasks': [],
    }) as unknown as typeof fetch

    render(<App />)

    await waitFor(() => expect(screen.getByText(/current tasks/i)).toBeInTheDocument())
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()

    const stateSelect = screen.getByLabelText('State') as HTMLSelectElement
    const stateOptions = Array.from(stateSelect.options).map((option) => option.value)
    expect(stateOptions).toEqual(['TODO', 'WORKING', 'DONE'])

    expect(screen.getByLabelText('Importance')).toBeInTheDocument()
  })

  it('includes credentials on task requests once authenticated', async () => {
    const fetchMock = mockFetch({
      '/api/auth/me': { email: 'alice@example.com' },
      '/api/auth/providers': { enabled: false, providers: [] },
      '/api/tasks': [],
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    render(<App />)

    await waitFor(() => expect(screen.getByText(/current tasks/i)).toBeInTheDocument())

    const taskCall = fetchMock.mock.calls.find(([input]) =>
      (typeof input === 'string' ? input : input.toString()).includes('/api/tasks'),
    )
    expect(taskCall?.[1]).toMatchObject({ credentials: 'include' })
  })

  it('offers a sign-out link when authenticated', async () => {
    globalThis.fetch = mockFetch({
      '/api/auth/me': { email: 'alice@example.com' },
      '/api/auth/providers': { enabled: true, providers: [] },
      '/api/tasks': [],
    }) as unknown as typeof fetch

    render(<App />)

    await waitFor(() => expect(screen.getByText(/current tasks/i)).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /sign out/i })).toHaveAttribute(
      'href',
      expect.stringContaining('/api/auth/logout'),
    )
  })

  it('renders a disabled placeholder for providers that are not configured', async () => {
    globalThis.fetch = mockFetch({
      '/api/auth/me': 'error',
      '/api/auth/providers': {
        enabled: false,
        providers: [
          { id: 'apple', label: 'Apple', available: false, loginUrl: null, issuer: 'https://appleid.apple.com' },
        ],
      },
    }) as unknown as typeof fetch

    render(<App />)

    await waitFor(() => expect(screen.getByText('Please sign in to continue.')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /configure credentials/i })).toBeDisabled()
    expect(screen.queryByRole('link', { name: /continue with apple/i })).not.toBeInTheDocument()
  })

  it('lists existing tasks with their state and importance', async () => {
    globalThis.fetch = mockFetch({
      '/api/auth/me': { email: 'alice@example.com' },
      '/api/auth/providers': { enabled: true, providers: [] },
      '/api/tasks': [
        { id: 1, description: 'Write the report', dueDate: '2026-12-31', importance: 'HIGH', state: 'WORKING' },
      ],
    }) as unknown as typeof fetch

    render(<App />)

    await waitFor(() => expect(screen.getByText('Write the report')).toBeInTheDocument())
    expect(screen.getByText('Due 2026-12-31')).toBeInTheDocument()
    expect(screen.getByText('Importance: HIGH')).toBeInTheDocument()
    expect(screen.getByLabelText('Update state')).toHaveValue('WORKING')
  })

  it('creates a task, shows it, and clears the form', async () => {
    const created = {
      id: 7,
      description: 'Write the report',
      dueDate: '2026-12-31',
      importance: 'HIGH',
      state: 'WORKING',
    }
    const fetchMock = mockApi({ me: ALICE, tasks: [], post: { status: 201, body: created } })
    await renderSignedIn(fetchMock)

    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Write the report' } })
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-12-31' } })
    fireEvent.change(screen.getByLabelText('Importance'), { target: { value: 'HIGH' } })
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'WORKING' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Write the report' })).toBeInTheDocument())
    expect(bodyOf(fetchMock, 'POST')).toEqual({
      description: 'Write the report',
      dueDate: '2026-12-31',
      importance: 'HIGH',
      state: 'WORKING',
    })
    // The form goes back to initialForm, not merely blank: importance returns to MEDIUM.
    expect(screen.getByLabelText('Description')).toHaveValue('')
    expect(screen.getByLabelText('Importance')).toHaveValue('MEDIUM')
    expect(screen.getByLabelText('State')).toHaveValue('TODO')
  })

  it('reports a failed create without losing what was typed', async () => {
    const fetchMock = mockApi({ me: ALICE, tasks: [], post: { status: 500 } })
    await renderSignedIn(fetchMock)

    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Doomed task' } })
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-12-31' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))

    await waitFor(() => expect(screen.getByText('Unable to create task.')).toBeInTheDocument())
    expect(screen.getByLabelText('Description')).toHaveValue('Doomed task')
  })

  it('moves a task to another state and sends the whole task back', async () => {
    const task = {
      id: 3,
      description: 'Write the report',
      dueDate: '2026-12-31',
      importance: 'HIGH',
      state: 'TODO',
    }
    const fetchMock = mockApi({
      me: ALICE,
      tasks: [task],
      put: { status: 200, body: { ...task, state: 'DONE' } },
    })
    await renderSignedIn(fetchMock)

    fireEvent.change(await screen.findByLabelText('Update state'), { target: { value: 'DONE' } })

    await waitFor(() => expect(screen.getByLabelText('Update state')).toHaveValue('DONE'))
    // The backend replaces the whole task, so a partial patch would silently blank the rest.
    expect(bodyOf(fetchMock, 'PUT')).toEqual({ ...task, state: 'DONE' })
  })

  it('reports a failed state change', async () => {
    const task = {
      id: 3,
      description: 'Write the report',
      dueDate: '2026-12-31',
      importance: 'HIGH',
      state: 'TODO',
    }
    const fetchMock = mockApi({ me: ALICE, tasks: [task], put: { status: 500 } })
    await renderSignedIn(fetchMock)

    fireEvent.change(await screen.findByLabelText('Update state'), { target: { value: 'DONE' } })

    await waitFor(() => expect(screen.getByText('Unable to update task state.')).toBeInTheDocument())
  })

  it('reports a failure to load the board', async () => {
    await renderSignedIn(mockApi({ me: ALICE, tasks: 'error' }))

    await waitFor(() =>
      expect(screen.getByText('Unable to load tasks from the backend.')).toBeInTheDocument(),
    )
  })

  it('renders tasks in due date order whatever order they arrive in', async () => {
    await renderSignedIn(
      mockApi({
        me: ALICE,
        tasks: [
          { id: 1, description: 'Last', dueDate: '2026-12-31', importance: 'LOW', state: 'TODO' },
          { id: 2, description: 'First', dueDate: '2026-01-01', importance: 'LOW', state: 'TODO' },
          { id: 3, description: 'Middle', dueDate: '2026-06-15', importance: 'LOW', state: 'TODO' },
        ],
      }),
    )

    await waitFor(() => expect(screen.getByRole('heading', { name: 'First' })).toBeInTheDocument())
    // Only task cards use h3 in the signed-in view; the provider cards are not rendered.
    const rendered = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
    expect(rendered).toEqual(['First', 'Middle', 'Last'])
  })

  it('says so when there is nothing on the board', async () => {
    await renderSignedIn(mockApi({ me: ALICE, tasks: [] }))

    await waitFor(() => expect(screen.getByText('No tasks yet.')).toBeInTheDocument())
    expect(screen.queryByText('Loading tasks…')).not.toBeInTheDocument()
  })


  it('still renders the signed-out view when the provider list cannot be fetched', async () => {
    globalThis.fetch = mockApi({ me: 'error', providers: 'error' }) as unknown as typeof fetch
    render(<App />)

    await waitFor(() => expect(screen.getByText('Please sign in to continue.')).toBeInTheDocument())
    // Falling back to the initial empty list rather than breaking outright is the point.
    expect(screen.getByText('No authentication providers are configured yet.')).toBeInTheDocument()
  })

  it('falls back to a generic message when the failure is not an Error', async () => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/auth/me')) {
        return respond(ALICE)
      }
      if (url.includes('/api/auth/providers')) {
        return respond({ enabled: true, providers: [] })
      }
      // A rejection carrying something other than an Error, which a catch binding types as
      // unknown and which has no .message to show.
      return Promise.reject('network is down')
    }) as unknown as typeof fetch

    render(<App />)

    await waitFor(() =>
      expect(screen.getByText('Unexpected error while loading data.')).toBeInTheDocument(),
    )
  })

  it('leaves the other tasks alone when one changes state', async () => {
    const first = { id: 1, description: 'First', dueDate: '2026-01-01', importance: 'LOW', state: 'TODO' }
    const second = { id: 2, description: 'Second', dueDate: '2026-02-02', importance: 'HIGH', state: 'TODO' }
    const fetchMock = mockApi({
      me: ALICE,
      tasks: [first, second],
      put: { status: 200, body: { ...first, state: 'DONE' } },
    })
    await renderSignedIn(fetchMock)

    const [firstSelect] = await screen.findAllByLabelText('Update state')
    fireEvent.change(firstSelect, { target: { value: 'DONE' } })

    await waitFor(() => expect(screen.getAllByLabelText('Update state')[0]).toHaveValue('DONE'))
    expect(screen.getAllByLabelText('Update state')[1]).toHaveValue('TODO')
    expect(screen.getByRole('heading', { name: 'Second' })).toBeInTheDocument()
  })

  it('shows a loading note until the board arrives', async () => {
    let releaseTasks: (response: Response) => void = () => {}
    const tasks = new Promise<Response>((resolve) => {
      releaseTasks = resolve
    })

    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/auth/me')) {
        return respond(ALICE)
      }
      if (url.includes('/api/auth/providers')) {
        return respond({ enabled: true, providers: [] })
      }
      return tasks
    }) as unknown as typeof fetch

    render(<App />)

    await waitFor(() => expect(screen.getByText('Loading tasks…')).toBeInTheDocument())

    releaseTasks(new Response(JSON.stringify([]), { status: 200 }))

    await waitFor(() => expect(screen.queryByText('Loading tasks…')).not.toBeInTheDocument())
    expect(screen.getByText('No tasks yet.')).toBeInTheDocument()
  })

})
