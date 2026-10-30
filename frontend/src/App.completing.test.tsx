/**
 * Completing a task: one click on its checkbox sends the whole task back, done; unticking puts it
 * back; and a save that fails rolls the tick back and says so.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stubApi } from './testing/api'
import { ALICE, bodyOf, isoIn, renderSignedIn, task } from './testing/board'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('completing a task', () => {
  it('finishes a task in one click and sends the whole task back', async () => {
    const done = task({ id: 4, description: 'Pay the invoice', dueDate: isoIn(1), state: 'DONE' })
    const fetchMock = stubApi({
      me: ALICE,
      tasks: [task({ id: 4, description: 'Pay the invoice', dueDate: isoIn(1) })],
      put: { status: 200, body: done },
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(screen.getByLabelText('Mark "Pay the invoice" as done'))

    await waitFor(() => expect(screen.getByText('Completed (1)')).toBeInTheDocument())
    expect(bodyOf(fetchMock, 'PUT')).toEqual({
      description: 'Pay the invoice',
      dueDate: isoIn(1),
      importance: 'MEDIUM',
      state: 'DONE',
    })
    expect(screen.getByLabelText('Mark "Pay the invoice" as done')).toBeChecked()
  })

  it('completes a task whose due date has already passed', async () => {
    const overdue = isoIn(-3)
    const fetchMock = stubApi({
      me: ALICE,
      tasks: [task({ id: 5, description: 'Late thing', dueDate: overdue })],
      put: { status: 200, body: task({ id: 5, description: 'Late thing', dueDate: overdue, state: 'DONE' }) },
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(screen.getByLabelText('Mark "Late thing" as done'))

    await waitFor(() => expect(screen.getByText('Completed (1)')).toBeInTheDocument())
    expect(bodyOf(fetchMock, 'PUT')).toMatchObject({ dueDate: overdue, state: 'DONE' })
  })

  it('puts a completed task back when it is unticked', async () => {
    const fetchMock = stubApi({
      me: ALICE,
      tasks: [task({ id: 6, description: 'Done thing', state: 'DONE' })],
      put: { status: 200, body: task({ id: 6, description: 'Done thing', state: 'TODO' }) },
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(screen.getByLabelText('Mark "Done thing" as done'))

    await waitFor(() => expect(bodyOf(fetchMock, 'PUT')).toMatchObject({ state: 'TODO' }))
    await waitFor(() => expect(screen.queryByText(/^Completed/)).not.toBeInTheDocument())
  })

  it('rolls the tick back and explains itself when the save fails', async () => {
    const fetchMock = stubApi({
      me: ALICE,
      tasks: [task({ id: 7, description: 'Stubborn thing' })],
      put: { status: 500 },
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(screen.getByLabelText('Mark "Stubborn thing" as done'))

    await waitFor(() => expect(screen.getByText('Unable to update task.')).toBeInTheDocument())
    expect(screen.getByLabelText('Mark "Stubborn thing" as done')).not.toBeChecked()
  })

  it('leaves the other tasks alone when one changes state', async () => {
    const fetchMock = stubApi({
      me: ALICE,
      tasks: [
        task({ id: 1, description: 'First', dueDate: isoIn(2) }),
        task({ id: 2, description: 'Second', dueDate: isoIn(3) }),
      ],
      put: { status: 200, body: task({ id: 1, description: 'First', dueDate: isoIn(2), state: 'DONE' }) },
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(screen.getByLabelText('Mark "First" as done'))

    await waitFor(() => expect(screen.getByLabelText('Mark "First" as done')).toBeChecked())
    expect(screen.getByLabelText('Mark "Second" as done')).not.toBeChecked()
  })
})
