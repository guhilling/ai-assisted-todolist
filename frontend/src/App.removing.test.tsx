/**
 * Removing tasks: deleting one from its menu, clearing every completed one at once, and the offer
 * to undo either -- which puts the task back by creating it again, repairing an overdue date the
 * backend would refuse.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stubApi } from './testing/api'
import { ALICE, TODAY, bodyOf, isoIn, openMenu, renderSignedIn, task } from './testing/board'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('removing tasks', () => {
  it('deletes a task from its menu', async () => {
    const fetchMock = stubApi({ me: ALICE, tasks: [task({ id: 11, description: 'Unwanted' })] })
    await renderSignedIn(fetchMock)

    fireEvent.click(openMenu('Unwanted').getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByLabelText('Mark "Unwanted" as done')).not.toBeInTheDocument())
    expect(fetchMock.mock.calls.some(([url, init]) => init?.method === 'DELETE' && String(url).endsWith('/11'))).toBe(
      true,
    )
  })

  it('puts the task back when the delete fails', async () => {
    const fetchMock = stubApi({
      me: ALICE,
      tasks: [task({ id: 12, description: 'Sticky' })],
      del: { status: 500 },
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(openMenu('Sticky').getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.getByText('Unable to delete task.')).toBeInTheDocument())
    expect(screen.getByLabelText('Mark "Sticky" as done')).toBeInTheDocument()
  })

  it('offers to undo, and puts the task back', async () => {
    const gone = task({ id: 13, description: 'Deleted by mistake', dueDate: isoIn(4) })
    const fetchMock = stubApi({
      me: ALICE,
      tasks: [gone],
      echoPost: true,
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(openMenu('Deleted by mistake').getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByText('Task deleted')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(screen.getByLabelText('Mark "Deleted by mistake" as done')).toBeInTheDocument())
    expect(bodyOf(fetchMock, 'POST')).toEqual({
      description: 'Deleted by mistake',
      dueDate: isoIn(4),
      importance: 'MEDIUM',
      state: 'TODO',
    })
    expect(screen.queryByText('Task deleted')).not.toBeInTheDocument()
  })

  it('restores an overdue task by creating it today and correcting the date', async () => {
    // Creating refuses a date in the past, so a plain re-create would fail for exactly the
    // tasks people delete most. The date is repaired by an update, which does allow one.
    const overdue = isoIn(-5)
    const gone = task({ id: 14, description: 'Long overdue', dueDate: overdue })
    const fetchMock = stubApi({
      me: ALICE,
      tasks: [gone],
      echoPost: true,
      put: { status: 200, body: { ...gone, id: 98 } },
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(openMenu('Long overdue').getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByText('Task deleted')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(screen.getByLabelText('Mark "Long overdue" as done')).toBeInTheDocument())
    expect(bodyOf(fetchMock, 'POST')).toMatchObject({ dueDate: TODAY })
    expect(bodyOf(fetchMock, 'PUT')).toMatchObject({ dueDate: overdue })
  })

  it('reports a restore that fails', async () => {
    const gone = task({ id: 15, description: 'Unrestorable', dueDate: isoIn(4) })
    const fetchMock = stubApi({ me: ALICE, tasks: [gone], post: { status: 500 } })
    await renderSignedIn(fetchMock)

    fireEvent.click(openMenu('Unrestorable').getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByText('Task deleted')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(screen.getByText('Unable to create task.')).toBeInTheDocument())
  })

  it('can be dismissed', async () => {
    // No fake clock: dismissing is a click, and the countdown is another test's business.
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ id: 16, description: 'Gone for good' })] }))

    fireEvent.click(openMenu('Gone for good').getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByText('Task deleted')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByText('Task deleted')).not.toBeInTheDocument()
  })

  it('withdraws the offer after a few seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ id: 17, description: 'Times out' })] }))

      fireEvent.click(openMenu('Times out').getByRole('button', { name: 'Delete' }))
      await waitFor(() => expect(screen.getByText('Task deleted')).toBeInTheDocument())

      // advanceTimersByTimeAsync, not the synchronous form: it yields between timers so the
      // state update the callback schedules is actually flushed. And the disappearance is
      // waited for rather than asserted on the next line -- advancing the clock says the
      // callback ran, not that React has re-rendered, and asserting instantly made this test
      // fail on a loaded CI runner roughly one run in three.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8000)
      })

      await waitFor(() => expect(screen.queryByText('Task deleted')).not.toBeInTheDocument())
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not offer an undo for a delete that failed', async () => {
    const fetchMock = stubApi({
      me: ALICE,
      tasks: [task({ id: 18, description: 'Sticky again' })],
      del: { status: 500 },
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(openMenu('Sticky again').getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.getByText('Unable to delete task.')).toBeInTheDocument())
    expect(screen.queryByText('Task deleted')).not.toBeInTheDocument()
  })

  it('clears every completed task at once', async () => {
    const fetchMock = stubApi({
      me: ALICE,
      tasks: [
        task({ id: 21, description: 'Done one', state: 'DONE' }),
        task({ id: 22, description: 'Done two', state: 'DONE' }),
        task({ id: 23, description: 'Still open' }),
      ],
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(screen.getByRole('button', { name: /clear completed/i }))

    await waitFor(() => expect(screen.queryByText(/^Completed/)).not.toBeInTheDocument())
    const deleted = fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE').map(([url]) => String(url))
    expect(deleted).toHaveLength(2)
    expect(screen.getByLabelText('Mark "Still open" as done')).toBeInTheDocument()
    // One offer covering the batch, not one per task.
    expect(screen.getByText('2 tasks deleted')).toBeInTheDocument()
  })

  it('offers no undo when clearing the completed section fails outright', async () => {
    const fetchMock = stubApi({
      me: ALICE,
      tasks: [
        task({ id: 26, description: 'Done one', dueDate: isoIn(2), state: 'DONE' }),
        task({ id: 27, description: 'Done two', dueDate: isoIn(3), state: 'DONE' }),
      ],
      del: { status: 500 },
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(screen.getByRole('button', { name: /clear completed/i }))

    await waitFor(() => expect(screen.getByText('Unable to delete task.')).toBeInTheDocument())
    // Nothing was removed, so there is nothing to offer back.
    expect(screen.queryByText(/deleted$/)).not.toBeInTheDocument()
    expect(screen.getByText('Completed (2)')).toBeInTheDocument()
  })

  it('puts a whole cleared batch back', async () => {
    const one = task({ id: 24, description: 'Done one', dueDate: isoIn(2), state: 'DONE' })
    const two = task({ id: 25, description: 'Done two', dueDate: isoIn(3), state: 'DONE' })
    const fetchMock = stubApi({
      me: ALICE,
      tasks: [one, two],
      echoPost: true,
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(screen.getByRole('button', { name: /clear completed/i }))
    await waitFor(() => expect(screen.getByText('2 tasks deleted')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(screen.getByText('Completed (2)')).toBeInTheDocument())
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2)
  })
})
