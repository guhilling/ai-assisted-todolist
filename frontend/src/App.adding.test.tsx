/**
 * Adding a task: the add row, its due-date shortcuts, what it sends, how it fails and how it
 * closes (#383); and the `n` shortcut that opens it (#396).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { stubApi } from './testing/api'
import { ALICE, bodyOf, isoIn, renderSignedIn, startAdding, task } from './testing/board'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('adding a task', () => {
  it('adds a task, shows it, and closes the add row, as the app does (#383)', async () => {
    const created = task({ id: 9, description: 'Buy milk', dueDate: isoIn(1) })
    const fetchMock = stubApi({ me: ALICE, tasks: [], post: { status: 201, body: created } })
    await renderSignedIn(fetchMock)

    startAdding('Buy milk')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(screen.getByLabelText('Mark "Buy milk" as done')).toBeInTheDocument())
    expect(bodyOf(fetchMock, 'POST')).toEqual({
      description: 'Buy milk',
      dueDate: isoIn(1),
      importance: 'MEDIUM',
      state: 'TODO',
    })
    expect(screen.queryByLabelText('What needs doing')).not.toBeInTheDocument()
    // Where the next task starts: Enter, or n, opens the row again.
    expect(screen.getByRole('button', { name: /add a task/i })).toHaveFocus()
  })

  it('defaults to tomorrow, so adding a task needs no date interaction', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [] }))

    fireEvent.click(screen.getByRole('button', { name: /add a task/i }))

    expect(screen.getByLabelText('Due date')).toHaveValue(isoIn(1))
    expect(screen.getByRole('button', { name: 'Tomorrow' })).toHaveAttribute('aria-pressed', 'true')
  })

  it.each([
    ['Today', 0],
    ['Tomorrow', 1],
    ['In 1 week', 7],
    ['In 2 weeks', 14],
  ])('sets the due date from the %s shortcut', async (label, offset) => {
    const fetchMock = stubApi({
      me: ALICE,
      tasks: [],
      post: { status: 201, body: task({ id: 1, description: 'Chip task', dueDate: isoIn(offset) }) },
    })
    await renderSignedIn(fetchMock)

    startAdding('Chip task')
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(screen.getByLabelText('Due date')).toHaveValue(isoIn(offset))

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(bodyOf(fetchMock, 'POST')).toMatchObject({ dueDate: isoIn(offset) }))
  })

  it('carries the chosen importance and a typed date', async () => {
    const fetchMock = stubApi({
      me: ALICE,
      tasks: [],
      post: { status: 201, body: task({ id: 1, description: 'Urgent thing', dueDate: isoIn(5), importance: 'HIGH' }) },
    })
    await renderSignedIn(fetchMock)

    startAdding('Urgent thing')
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: isoIn(5) } })
    fireEvent.change(screen.getByLabelText('Importance'), { target: { value: 'HIGH' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(bodyOf(fetchMock, 'POST')).toMatchObject({ dueDate: isoIn(5), importance: 'HIGH' }),
    )
  })

  it('reports a failed add without losing what was typed', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [], post: { status: 500 } }))

    startAdding('Doomed task')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(screen.getByText('Unable to create task.')).toBeInTheDocument())
    expect(screen.getByLabelText('What needs doing')).toHaveValue('Doomed task')
  })

  it('will not add a task with no description', async () => {
    const fetchMock = stubApi({ me: ALICE, tasks: [] })
    await renderSignedIn(fetchMock)

    fireEvent.click(screen.getByRole('button', { name: /add a task/i }))
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()

    fireEvent.submit(screen.getByLabelText('What needs doing').closest('form') as HTMLFormElement)
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('keeps the add row open for any other key', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [] }))

    startAdding('Still typing')
    fireEvent.keyDown(screen.getByLabelText('What needs doing'), { key: 'a' })

    expect(screen.getByLabelText('What needs doing')).toHaveValue('Still typing')
  })

  it('gives the focus back to Add a task when closed with Escape or Cancel (#383)', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [] }))

    startAdding('Not now')
    fireEvent.keyDown(screen.getByLabelText('What needs doing'), { key: 'Escape' })
    expect(screen.getByRole('button', { name: /add a task/i })).toHaveFocus()

    startAdding('Not now either')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: /add a task/i })).toHaveFocus()
  })

  it('gives the focus back to the description when an add fails', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [], post: { status: 500 } }))

    startAdding('Doomed task')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(screen.getByText('Unable to create task.')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByLabelText('What needs doing')).toHaveFocus())
  })

  it('collapses on Escape and on Cancel, forgetting what was typed', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [] }))

    startAdding('Abandoned')
    fireEvent.keyDown(screen.getByLabelText('What needs doing'), { key: 'Escape' })
    expect(screen.getByRole('button', { name: /add a task/i })).toBeInTheDocument()

    startAdding('Abandoned again')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: /add a task/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /add a task/i }))
    expect(screen.getByLabelText('What needs doing')).toHaveValue('')
  })
})

describe('the keyboard shortcut', () => {
  it('opens the add row when n is pressed', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [] }))

    fireEvent.keyDown(document.body, { key: 'n' })

    expect(screen.getByLabelText('What needs doing')).toBeInTheDocument()
  })

  it('opens the add row with n pressed the moment the board is shown', async () => {
    // Pressed from a MutationObserver, the instant "Add a task" is in the page: after React's
    // commit, before its passive effects run, so a listener added by one would miss the key (#396).
    globalThis.fetch = stubApi({ me: ALICE, tasks: [] }) as unknown as typeof fetch
    let pressed = false
    const observer = new MutationObserver(() => {
      if (!pressed && screen.queryByRole('button', { name: /add a task/i })) {
        pressed = true
        fireEvent.keyDown(document.body, { key: 'n' })
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    try {
      render(<App />)

      expect(await screen.findByLabelText('What needs doing')).toBeInTheDocument()
    } finally {
      observer.disconnect()
    }
  })

  it('leaves the letter alone when it lands in a field', async () => {
    // A row's checkbox is a real input, so it stands in for "the caret is somewhere that
    // takes typing" -- where the shortcut must not swallow the letter.
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ id: 47, description: 'A task' })] }))

    fireEvent.keyDown(screen.getByLabelText('Mark "A task" as done'), { key: 'n' })

    expect(screen.queryByLabelText('What needs doing')).not.toBeInTheDocument()
  })

  it('does not fire when a modifier is held', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [] }))

    fireEvent.keyDown(document.body, { key: 'n', metaKey: true })
    expect(screen.queryByLabelText('What needs doing')).not.toBeInTheDocument()

    fireEvent.keyDown(document.body, { key: 'n', ctrlKey: true })
    expect(screen.queryByLabelText('What needs doing')).not.toBeInTheDocument()

    fireEvent.keyDown(document.body, { key: 'n', altKey: true })
    expect(screen.queryByLabelText('What needs doing')).not.toBeInTheDocument()
  })

  it('is ignored once the add row is already open', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [] }))

    startAdding('Typing away')
    fireEvent.keyDown(screen.getByLabelText('What needs doing'), { key: 'n' })

    expect(screen.getByLabelText('What needs doing')).toHaveValue('Typing away')
  })
})
