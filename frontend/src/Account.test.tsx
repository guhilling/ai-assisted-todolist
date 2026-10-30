/**
 * Deleting one's own account (#213), as the board offers it: behind a confirmation that says
 * what goes, then signed out, with a note on the signed-out page saying it happened.
 *
 * Against a stubbed `fetch`; that the backend really deletes everything is its own tests' business.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { stubApi, type ApiStub } from './testing/api'
import { ALICE, renderSignedIn } from './testing/board'

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

async function signedInBoard(fetchMock: ApiStub) {
  await renderSignedIn(fetchMock)
  // Sign out and Delete account are in the account dialog (#385).
  fireEvent.click(screen.getByRole('button', { name: 'Account' }))
}

describe('the account dialog (#385)', () => {
  it('keeps Sign out and Delete account behind Account, as the app does', async () => {
    globalThis.fetch = stubApi({ me: ALICE }) as unknown as typeof fetch
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: /add a task/i })).toBeInTheDocument())

    expect(screen.queryByRole('link', { name: 'Sign out' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Account' }))

    const dialog = screen.getByRole('dialog', { name: 'Account' })
    expect(dialog).toHaveTextContent('Signed in as alice@example.com')
    expect(screen.getByRole('link', { name: 'Sign out' })).toHaveAttribute('href', '/api/auth/logout')
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Account' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('takes the focus, and closes on Escape from there, giving it back to Account', async () => {
    await signedInBoard(stubApi({ me: ALICE }))

    expect(screen.getByRole('link', { name: 'Sign out' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Account' })).toHaveFocus()
  })

  it('closes when the focus leaves it', async () => {
    await signedInBoard(stubApi({ me: ALICE }))

    fireEvent.focusIn(screen.getByRole('button', { name: /add a task/i }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('holds still on Account while the confirmation inside it is open', async () => {
    await signedInBoard(stubApi({ me: ALICE }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    fireEvent.change(screen.getByLabelText('Type your email address to confirm'), { target: { value: 'alice@' } })

    fireEvent.click(screen.getByRole('button', { name: 'Account' }))
    fireEvent.pointerDown(screen.getByRole('heading', { level: 1, name: 'TaskFest' }))

    expect(screen.getByLabelText('Type your email address to confirm')).toHaveValue('alice@')
  })

  it('closes, confirmation and all, on Escape elsewhere in it', async () => {
    await signedInBoard(stubApi({ me: ALICE }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))

    fireEvent.keyDown(screen.getByRole('link', { name: 'Sign out' }), { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on a click outside it', async () => {
    await signedInBoard(stubApi({ me: ALICE }))

    fireEvent.pointerDown(screen.getByRole('heading', { level: 1, name: 'TaskFest' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on Account again', async () => {
    await signedInBoard(stubApi({ me: ALICE }))

    fireEvent.click(screen.getByRole('button', { name: 'Account' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('leaves itself open when Escape closes only the confirmation inside it', async () => {
    await signedInBoard(stubApi({ me: ALICE }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Account' })).toBeInTheDocument()
  })
})

describe('deleting the account', () => {
  it('asks first, saying what goes', async () => {
    const fetchMock = stubApi({ me: ALICE })
    await signedInBoard(fetchMock)

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Delete your account?' })
    expect(dialog).toHaveTextContent('Every task and every file you have here is deleted, for good.')
    expect(fetchMock).not.toHaveBeenCalledWith('/api/account', expect.anything())
  })

  it('does nothing when cancelled', async () => {
    const fetchMock = stubApi({ me: ALICE })
    await signedInBoard(fetchMock)

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep my account' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/account', expect.anything())
  })

  it('puts focus back on the button the confirmation was opened from', async () => {
    await signedInBoard(stubApi({ me: ALICE }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep my account' }))

    expect(screen.getByRole('button', { name: 'Delete account' })).toHaveFocus()
  })

  it('closes on Escape, as the row menus do', async () => {
    await signedInBoard(stubApi({ me: ALICE }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete account' })).toHaveFocus()
  })

  it('deletes, then signs out and leaves a note for the signed-out page', async () => {
    const fetchMock = stubApi({ me: ALICE })
    await signedInBoard(fetchMock)

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    fireEvent.change(screen.getByLabelText('Type your email address to confirm'), { target: { value: 'alice@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }))

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/api/auth/logout'))
    expect(fetchMock).toHaveBeenCalledWith('/api/account', expect.objectContaining({ method: 'DELETE' }))
    expect(sessionStorage.getItem('taskfest.accountDeleted')).toBe('true')
  })

  it('says so when the deletion failed, and stays signed in', async () => {
    await signedInBoard(stubApi({ me: ALICE, deleteAccount: { status: 500 } }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    fireEvent.change(screen.getByLabelText('Type your email address to confirm'), { target: { value: 'alice@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }))

    expect(await screen.findByText('Unable to delete your account.')).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })
})

describe('confirming by email address', () => {
  it('keeps the delete button disabled until the address is typed', async () => {
    await signedInBoard(stubApi({ me: ALICE }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))

    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeDisabled()
  })

  it('stays disabled for any other address', async () => {
    await signedInBoard(stubApi({ me: ALICE }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))

    fireEvent.change(screen.getByLabelText('Type your email address to confirm'), { target: { value: 'bob@example.com' } })

    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeDisabled()
  })

  it('accepts the address in any case and with spaces around it', async () => {
    await signedInBoard(stubApi({ me: ALICE }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))

    fireEvent.change(screen.getByLabelText('Type your email address to confirm'), { target: { value: ' Alice@Example.com ' } })

    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeEnabled()
  })
})

describe('after the deletion', () => {
  it('says once on the signed-out page that the account is gone', async () => {
    sessionStorage.setItem('taskfest.accountDeleted', 'true')
    globalThis.fetch = stubApi() as unknown as typeof fetch

    render(<App />)

    expect(
      await screen.findByText('Your account has been deleted. Signing in again starts a new, empty one.'),
    ).toBeInTheDocument()
    expect(sessionStorage.getItem('taskfest.accountDeleted')).toBeNull()
  })
})
