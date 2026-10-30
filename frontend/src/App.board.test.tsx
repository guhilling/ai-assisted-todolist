/**
 * The board itself: how it groups and orders the tasks, how a row says when one is due and how
 * much it matters, the weekday beside today and tomorrow (#337), the colours explained on first
 * use (#335), and that a task is open or done, nothing in between (#334).
 */
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubApi } from './testing/api'
import { ALICE, TODAY, isoIn, openMenu, renderSignedIn, rowFor, task } from './testing/board'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('the board', () => {
  it('shows each task with when it is due and how much it matters', async () => {
    await renderSignedIn(
      stubApi({
        me: ALICE,
        tasks: [task({ id: 7, description: 'Write the report', dueDate: isoIn(1), importance: 'HIGH' })],
      }),
    )

    const row = rowFor('Write the report')
    // The section heading already says when; the row does not say it a second time.
    expect(screen.getByRole('heading', { name: 'Tomorrow' })).toBeInTheDocument()
    expect(within(row).queryByText('Tomorrow')).not.toBeInTheDocument()
    expect(within(row).getByText('High')).toBeInTheDocument()
  })

  it('words a due date the section heading does not already say', async () => {
    await renderSignedIn(
      stubApi({
        me: ALICE,
        tasks: [
          task({ id: 8, description: 'Overdue one', dueDate: isoIn(-1) }),
          task({ id: 9, description: 'Done today', dueDate: isoIn(0), state: 'DONE' }),
        ],
      }),
    )

    // "Overdue" covers many days, so the row says which; "Completed" says nothing about dates.
    expect(within(rowFor('Overdue one')).getByText('Yesterday')).toBeInTheDocument()
    fireEvent.click(screen.getByText(/^Completed/))
    expect(within(rowFor('Done today')).getByText('Today')).toBeInTheDocument()
  })

  it('groups tasks by when they are due', async () => {
    await renderSignedIn(
      stubApi({
        me: ALICE,
        tasks: [
          task({ id: 1, description: 'Late thing', dueDate: isoIn(-2) }),
          task({ id: 2, description: 'Today thing', dueDate: TODAY }),
          task({ id: 3, description: 'Tomorrow thing', dueDate: isoIn(1) }),
          task({ id: 4, description: 'Week thing', dueDate: isoIn(3) }),
          task({ id: 5, description: 'Far thing', dueDate: isoIn(30) }),
        ],
      }),
    )

    expect(screen.getByRole('heading', { name: 'Overdue' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tomorrow' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'This week' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Later' })).toBeInTheDocument()
    expect(within(rowFor('Late thing')).getByText('2 days ago')).toBeInTheDocument()
  })

  it('renders tasks in due date order whatever order they arrive in', async () => {
    await renderSignedIn(
      stubApi({
        me: ALICE,
        tasks: [
          task({ id: 1, description: 'Second', dueDate: isoIn(20) }),
          task({ id: 2, description: 'First', dueDate: isoIn(10) }),
        ],
      }),
    )

    const descriptions = screen.getAllByText(/^(First|Second)$/).map((node) => node.textContent)
    expect(descriptions).toEqual(['First', 'Second'])
  })

  it('orders two tasks on the same day by id, so the board never reshuffles', async () => {
    await renderSignedIn(
      stubApi({
        me: ALICE,
        tasks: [
          task({ id: 9, description: 'Added later', dueDate: isoIn(2) }),
          task({ id: 2, description: 'Added first', dueDate: isoIn(2) }),
        ],
      }),
    )

    const descriptions = screen.getAllByText(/^Added (first|later)$/).map((node) => node.textContent)
    expect(descriptions).toEqual(['Added first', 'Added later'])
  })

  it('orders tasks due the same day by importance, high first', async () => {
    await renderSignedIn(
      stubApi({
        me: ALICE,
        tasks: [
          task({ id: 1, description: 'Low one', dueDate: isoIn(2), importance: 'LOW' }),
          task({ id: 2, description: 'Medium one', dueDate: isoIn(2), importance: 'MEDIUM' }),
          task({ id: 3, description: 'High one', dueDate: isoIn(2), importance: 'HIGH' }),
        ],
      }),
    )

    const descriptions = screen.getAllByText(/ one$/).map((node) => node.textContent)
    expect(descriptions).toEqual(['High one', 'Medium one', 'Low one'])
  })

  it('moves a task to its new place when its importance changes', async () => {
    // Created later than the medium one, so only its importance can put it first.
    const low = task({ id: 2, description: 'Becomes urgent', dueDate: isoIn(2), importance: 'LOW' })
    await renderSignedIn(
      stubApi({
        me: ALICE,
        tasks: [low, task({ id: 1, description: 'Already medium', dueDate: isoIn(2), importance: 'MEDIUM' })],
        put: { status: 200, body: { ...low, importance: 'HIGH' } },
      }),
    )

    fireEvent.click(openMenu('Becomes urgent').getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Importance' }), { target: { value: 'HIGH' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const descriptions = screen.getAllByText(/^(Becomes urgent|Already medium)$/).map((node) => node.textContent)
      expect(descriptions).toEqual(['Becomes urgent', 'Already medium'])
    })
  })

  it('leaves a section out when it has no tasks', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ description: 'Only tomorrow', dueDate: isoIn(1) })] }))

    expect(screen.getByRole('heading', { name: 'Tomorrow' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Overdue' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Later' })).not.toBeInTheDocument()
  })
})

describe('importance', () => {
  it('shows a dot, and says the word to a screen reader', async () => {
    await renderSignedIn(
      stubApi({ me: ALICE, tasks: [task({ id: 51, description: 'Urgent', importance: 'HIGH' })] }),
    )

    const row = rowFor('Urgent')
    // The word is present for assistive technology but carries no visible text of its own.
    expect(within(row).getByText('High')).toHaveClass('visually-hidden')
    expect(row.querySelector('.task-importance--high')).not.toBeNull()
  })

  it.each([
    ['LOW', 'Low'],
    ['MEDIUM', 'Medium'],
    ['HIGH', 'High'],
  ])('distinguishes %s', async (importance, label) => {
    await renderSignedIn(
      stubApi({ me: ALICE, tasks: [task({ id: 52, description: 'Graded', importance })] }),
    )

    const row = rowFor('Graded')
    expect(within(row).getByText(label)).toBeInTheDocument()
    expect(row.querySelector(`.task-importance--${importance.toLowerCase()}`)).not.toBeNull()
  })
})

describe('the weekday beside today and tomorrow (#337)', () => {
  /** The weekday the board should name for a date, as the browser names it. */
  const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })

  it('names the day beside the Today and Tomorrow headings, leaving the headings as they are', async () => {
    await renderSignedIn(
      stubApi({
        me: ALICE,
        tasks: [
          task({ id: 2, description: 'Today thing', dueDate: TODAY }),
          task({ id: 3, description: 'Tomorrow thing', dueDate: isoIn(1) }),
          task({ id: 4, description: 'Week thing', dueDate: isoIn(3) }),
        ],
      }),
    )

    const today = screen.getByRole('heading', { name: 'Today' }).closest('section')!
    const tomorrow = screen.getByRole('heading', { name: 'Tomorrow' }).closest('section')!
    expect(within(today).getByText(weekday(TODAY))).toBeInTheDocument()
    expect(within(tomorrow).getByText(weekday(isoIn(1)))).toBeInTheDocument()
    // "This week" lists its weekdays on the rows already.
    expect(screen.getByRole('heading', { name: 'This week' }).parentElement?.querySelector('.section-weekday')).toBeNull()
  })

  it('describes the heading with it, so moving by headings hears the day', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ id: 2, description: 'Today thing', dueDate: TODAY })] }))

    expect(screen.getByRole('heading', { name: 'Today' })).toHaveAccessibleDescription(weekday(TODAY))
  })

  it('names it beside a completed task done today too', async () => {
    await renderSignedIn(
      stubApi({ me: ALICE, tasks: [task({ id: 9, description: 'Done today', dueDate: TODAY, state: 'DONE' })] }),
    )

    fireEvent.click(screen.getByText(/^Completed/))
    expect(within(rowFor('Done today')).getByText('Today')).toBeInTheDocument()
    expect(within(rowFor('Done today')).getByText(weekday(TODAY))).toBeInTheDocument()
  })
})

describe('the colours, explained on first use (#335)', () => {
  afterEach(() => localStorage.removeItem('taskfest.coloursExplained'))

  it('explains the importance dots and the red date above the first board with tasks', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ id: 1, description: 'Pack the suitcase' })] }))

    const legend = screen.getByRole('note', { name: 'What the colours mean' })
    expect(legend).toHaveTextContent('Importance: High Medium Low. A date in red is overdue.')
    expect(legend.querySelectorAll('.task-importance')).toHaveLength(3)
  })

  it('goes once dismissed, and stays gone', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ id: 1, description: 'Pack the suitcase' })] }))

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))

    expect(screen.queryByRole('note', { name: 'What the colours mean' })).toBeNull()
    cleanup()
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ id: 1, description: 'Pack the suitcase' })] }))
    expect(screen.queryByRole('note', { name: 'What the colours mean' })).toBeNull()
  })

  it('waits while there are no tasks to explain', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [] }))

    expect(screen.queryByRole('note', { name: 'What the colours mean' })).toBeNull()
  })
})

describe('a task is open or done (#334)', () => {
  it('offers no "in progress" in the row menu', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ id: 51, description: 'Plain task' })] }))

    const menu = openMenu('Plain task')

    expect(menu.getAllByRole('button').map((button) => button.textContent)).toEqual(['Edit', 'Delete'])
  })

  it('shows a task still in progress, from an older app, as an open one', async () => {
    await renderSignedIn(
      stubApi({ me: ALICE, tasks: [task({ id: 52, description: 'Started elsewhere', state: 'WORKING' })] }),
    )

    expect(screen.getByLabelText('Mark "Started elsewhere" as done')).not.toBeChecked()
    expect(within(rowFor('Started elsewhere')).queryByText('doing')).toBeNull()
    expect(openMenu('Started elsewhere').getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Edit',
      'Delete',
    ])
  })
})
