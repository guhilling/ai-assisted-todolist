/**
 * The session: the board once someone is signed in, who it says that is, what it shows while the
 * tasks are still on their way or will not come, and the way back in once the session has expired.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { respond, stubApi } from './testing/api'
import { ALICE, GOOGLE, renderSignedIn, task } from './testing/board'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('signed in', () => {
  it('carries the product name', async () => {
    await renderSignedIn(stubApi({ me: ALICE }))

    expect(screen.getByRole('heading', { level: 1, name: 'TaskFest' })).toBeInTheDocument()
  })

  it('shows who is signed in and a way out', async () => {
    await renderSignedIn(stubApi({ me: ALICE }))

    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    // Behind Account (#385).
    fireEvent.click(screen.getByRole('button', { name: 'Account' }))
    expect(screen.getByRole('link', { name: /sign out/i })).toHaveAttribute('href', '/api/auth/logout')
  })

  it('sends credentials on task requests', async () => {
    const fetchMock = stubApi({ me: ALICE })
    await renderSignedIn(fetchMock)

    const tasksCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/tasks'))
    expect(tasksCall?.[1]).toMatchObject({ credentials: 'include' })
  })

  it('says when there is nothing on the board', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [] }))

    expect(screen.getByText('Nothing here yet. Add your first task.')).toBeInTheDocument()
  })

  it('offers nothing to interact with until the board has arrived', async () => {
    // The list response replaces the whole array, so anything added or ticked before it
    // lands is discarded. The board therefore stays out of reach until it is real.
    let releaseTasks: (value: Response) => void = () => {}
    const tasksArrived = new Promise<Response>((resolve) => {
      releaseTasks = resolve
    })
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/me')) {
        return respond(ALICE)
      }
      if (url.includes('/api/auth/providers')) {
        return respond({ enabled: true, providers: [] })
      }
      return tasksArrived
    }) as unknown as typeof fetch

    render(<App />)

    await waitFor(() => expect(screen.getByText('Loading tasks…')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /add a task/i })).not.toBeInTheDocument()

    releaseTasks(new Response(JSON.stringify([]), { status: 200 }))

    await waitFor(() => expect(screen.getByRole('button', { name: /add a task/i })).toBeInTheDocument())
  })

  it('shows a loading note until the board arrives', async () => {
    // The board's own fetch is held open, because the loading state is by nature transient:
    // letting the stub resolve immediately makes this a race that passes on timing rather
    // than on behaviour.
    let releaseTasks: (value: Response) => void = () => {}
    const tasksArrived = new Promise<Response>((resolve) => {
      releaseTasks = resolve
    })
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/me')) {
        return respond(ALICE)
      }
      if (url.includes('/api/auth/providers')) {
        return respond({ enabled: true, providers: [] })
      }
      return tasksArrived
    }) as unknown as typeof fetch

    render(<App />)

    await waitFor(() => expect(screen.getByText('Loading tasks…')).toBeInTheDocument())

    releaseTasks(new Response(JSON.stringify([]), { status: 200 }))

    await waitFor(() => expect(screen.queryByText('Loading tasks…')).not.toBeInTheDocument())
    expect(screen.getByText('Nothing here yet. Add your first task.')).toBeInTheDocument()
  })

  it('reports a failure to load the board', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: 'server-error' }))

    await waitFor(() =>
      expect(screen.getByText('Unable to load tasks from the backend.')).toBeInTheDocument(),
    )
  })

  it('falls back to a generic message when the failure is not an Error', async () => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/me')) {
        return Promise.resolve(new Response(JSON.stringify(ALICE), { status: 200 }))
      }
      if (url.includes('/api/auth/providers')) {
        return Promise.resolve(new Response(JSON.stringify({ enabled: true, providers: [] }), { status: 200 }))
      }
      return Promise.reject('not an Error at all')
    }) as unknown as typeof fetch
    render(<App />)

    await waitFor(() => expect(screen.getByText('Unexpected error while loading data.')).toBeInTheDocument())
  })

  it('shows a failure on the signed-out page when the session probe itself breaks', async () => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/api/auth/providers')) {
        return respond({ enabled: true, providers: [GOOGLE] })
      }
      return Promise.reject(new Error('Network is down.'))
    }) as unknown as typeof fetch
    render(<App />)

    await waitFor(() => expect(screen.getByText('Network is down.')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /sign in with google/i })).toBeInTheDocument()
  })
})

describe('who is signed in', () => {
  it('shows the display name in place of the email when the provider gave one', async () => {
    await renderSignedIn(stubApi({ me: { ...ALICE, name: 'Alice Example' }, tasks: [] }))

    expect(screen.getByText('Alice Example')).toBeInTheDocument()
    expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument()
  })

  it('falls back to the email when there is no name', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [] }))

    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
  })

  it('shows the picture the backend resolved', async () => {
    await renderSignedIn(
      stubApi({ me: { ...ALICE, pictureUrl: 'https://example.com/alice.png' }, tasks: [] }),
    )

    const avatar = document.querySelector('.user-avatar') as HTMLImageElement
    expect(avatar.tagName).toBe('IMG')
    expect(avatar).toHaveAttribute('src', 'https://example.com/alice.png')
  })

  it('falls back to initials when the picture will not load', async () => {
    // A URL the backend confirmed can still rot; a broken image icon is worse than initials.
    await renderSignedIn(
      stubApi({
        me: { ...ALICE, name: 'Alice Example', pictureUrl: 'https://example.com/gone.png' },
        tasks: [],
      }),
    )

    fireEvent.error(document.querySelector('.user-avatar') as HTMLImageElement)

    expect(screen.getByText('AE')).toBeInTheDocument()
  })

  it.each([
    ['a two-word name', { name: 'Gunnar Hilling' }, 'GH'],
    ['a one-word name', { name: 'Gunnar' }, 'G'],
    ['a dotted email local part', { name: null }, 'AE'],
  ])('builds initials from %s', async (_case, extra, expected) => {
    const me = { email: 'alice.example@example.com', ...extra }
    await renderSignedIn(stubApi({ me, tasks: [] }))

    expect(screen.getByText(expected)).toBeInTheDocument()
  })
})

/**
 * A session can end while the board is open -- Google's sign-in lasts an hour unless renewed --
 * and every later request then comes back 401, or 499 for a script that asked not to be
 * redirected. That is "signed out", not a failure: the board says so and offers the way back in,
 * rather than showing an error message about the request that happened to notice.
 */
describe('an expired session', () => {
  it('shows a notice and the way back in when loading the board finds it gone', async () => {
    globalThis.fetch = stubApi({
      me: ALICE,
      providers: { enabled: true, providers: [GOOGLE] },
      tasks: 'error',
    }) as unknown as typeof fetch
    render(<App />)

    await waitFor(() => expect(screen.getByText(/your session has expired/i)).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /sign in with google/i })).toHaveAttribute('href', '/api/auth/login')
    expect(screen.queryByRole('button', { name: /add a task/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Unable to load tasks from the backend.')).not.toBeInTheDocument()
  })

  it('shows the notice when a change finds the session gone, not an error about the change', async () => {
    const fetchMock = stubApi({
      me: ALICE,
      providers: { enabled: true, providers: [GOOGLE] },
      tasks: [task({ id: 7, description: 'Late night' })],
      put: { status: 499 },
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(screen.getByLabelText('Mark "Late night" as done'))

    await waitFor(() => expect(screen.getByText(/your session has expired/i)).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /sign in with google/i })).toBeInTheDocument()
    expect(screen.queryByText('Unable to update task.')).not.toBeInTheDocument()
  })
})
