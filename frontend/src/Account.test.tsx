/**
 * Deleting one's own account (#213), as the board offers it: behind a confirmation that says
 * what goes, then signed out, with a note on the signed-out page saying it happened.
 *
 * Against a stubbed `fetch`; that the backend really deletes everything is its own tests' business.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

function json(value: unknown, status = 200) {
  return Promise.resolve(new Response(value === null ? null : JSON.stringify(value), { status }))
}

function backend(options: { signedIn: boolean; deleteStatus?: number }) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/auth/me')) {
      return options.signedIn ? json({ email: 'alice@example.com' }) : json(null, 401)
    }
    if (url.includes('/api/auth/providers')) {
      return json({ enabled: true, providers: [] })
    }
    if (url.endsWith('/api/account') && init?.method === 'DELETE') {
      return json(null, options.deleteStatus ?? 204)
    }
    if (url.endsWith('/api/tasks')) {
      return json([])
    }
    return json(null, 404)
  })
}

let assign: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
  assign = vi.fn()
  vi.stubGlobal('location', { ...window.location, assign })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function signedInBoard(fetchMock: ReturnType<typeof backend>) {
  globalThis.fetch = fetchMock as unknown as typeof fetch
  render(<App />)
  await waitFor(() => expect(screen.getByRole('button', { name: /add a task/i })).toBeInTheDocument())
}

describe('deleting the account', () => {
  it('asks first, saying what goes', async () => {
    const fetchMock = backend({ signedIn: true })
    await signedInBoard(fetchMock)

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Delete your account?' })
    expect(dialog).toHaveTextContent('Every task and every file you have here is deleted, for good.')
    expect(fetchMock).not.toHaveBeenCalledWith('/api/account', expect.anything())
  })

  it('does nothing when cancelled', async () => {
    const fetchMock = backend({ signedIn: true })
    await signedInBoard(fetchMock)

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep my account' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/account', expect.anything())
  })

  it('puts focus back on the button the confirmation was opened from', async () => {
    await signedInBoard(backend({ signedIn: true }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep my account' }))

    expect(screen.getByRole('button', { name: 'Delete account' })).toHaveFocus()
  })

  it('closes on Escape, as the row menus do', async () => {
    await signedInBoard(backend({ signedIn: true }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete account' })).toHaveFocus()
  })

  it('deletes, then signs out and leaves a note for the signed-out page', async () => {
    const fetchMock = backend({ signedIn: true })
    await signedInBoard(fetchMock)

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    fireEvent.change(screen.getByLabelText('Type your email address to confirm'), { target: { value: 'alice@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }))

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/api/auth/logout'))
    expect(fetchMock).toHaveBeenCalledWith('/api/account', expect.objectContaining({ method: 'DELETE' }))
    expect(sessionStorage.getItem('taskfest.accountDeleted')).toBe('true')
  })

  it('says so when the deletion failed, and stays signed in', async () => {
    await signedInBoard(backend({ signedIn: true, deleteStatus: 500 }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    fireEvent.change(screen.getByLabelText('Type your email address to confirm'), { target: { value: 'alice@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }))

    expect(await screen.findByText('Unable to delete your account.')).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })
})

describe('confirming by email address', () => {
  it('keeps the delete button disabled until the address is typed', async () => {
    await signedInBoard(backend({ signedIn: true }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))

    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeDisabled()
  })

  it('stays disabled for any other address', async () => {
    await signedInBoard(backend({ signedIn: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))

    fireEvent.change(screen.getByLabelText('Type your email address to confirm'), { target: { value: 'bob@example.com' } })

    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeDisabled()
  })

  it('accepts the address in any case and with spaces around it', async () => {
    await signedInBoard(backend({ signedIn: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))

    fireEvent.change(screen.getByLabelText('Type your email address to confirm'), { target: { value: ' Alice@Example.com ' } })

    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeEnabled()
  })
})

describe('after the deletion', () => {
  it('says once on the signed-out page that the account is gone', async () => {
    sessionStorage.setItem('taskfest.accountDeleted', 'true')
    globalThis.fetch = backend({ signedIn: false }) as unknown as typeof fetch

    render(<App />)

    expect(
      await screen.findByText('Your account has been deleted. Signing in again starts a new, empty one.'),
    ).toBeInTheDocument()
    expect(sessionStorage.getItem('taskfest.accountDeleted')).toBeNull()
  })
})
