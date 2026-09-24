import { render, screen, waitFor } from '@testing-library/react'
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
})
