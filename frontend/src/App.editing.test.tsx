/**
 * Editing a task: the row menu it starts from, the editor and what it saves or discards, and the
 * calendar on the due-date field -- which the add row shares, so two of its cases start there.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stubApi } from './testing/api'
import { ALICE, bodyOf, findCalendar, isoIn, openMenu, renderSignedIn, rowFor, startAdding, task } from './testing/board'

/** The `<details>` element backing a row's menu, for asserting whether it is open. */
function menuOf(description: string) {
  return rowFor(description).querySelector('details') as HTMLDetailsElement
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('the row menu', () => {
  it('closes once an action has been chosen', async () => {
    const fetchMock = stubApi({
      me: ALICE,
      tasks: [task({ id: 41, description: 'Menu task' })],
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(openMenu('Menu task').getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(menuOf('Menu task').open).toBe(false)
  })

  it('survives the click that opened it', async () => {
    // React can flush the effect while the opening click is still propagating, which closed
    // the menu the instant it opened. Only the browser showed it; jsdom did not.
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ id: 44, description: 'Menu task' })] }))

    const summary = within(rowFor('Menu task')).getByLabelText('Actions for "Menu task"')
    fireEvent.click(summary)
    fireEvent.click(summary.closest('details') as HTMLElement)

    expect(menuOf('Menu task').open).toBe(true)
  })

  it('closes on Escape and hands focus back to the trigger', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ id: 45, description: 'Menu task' })] }))

    openMenu('Menu task')
    expect(menuOf('Menu task').open).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(menuOf('Menu task').open).toBe(false)
    expect(within(rowFor('Menu task')).getByLabelText('Actions for "Menu task"')).toHaveFocus()
  })

  it('ignores other keys while it is open', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ id: 46, description: 'Menu task' })] }))

    openMenu('Menu task')
    fireEvent.keyDown(document, { key: 'a' })

    expect(menuOf('Menu task').open).toBe(true)
  })

  it('closes when the click lands somewhere else', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ id: 42, description: 'Menu task' })] }))

    openMenu('Menu task')
    expect(menuOf('Menu task').open).toBe(true)

    fireEvent.click(document.body)

    expect(menuOf('Menu task').open).toBe(false)
  })

  it('stays open until something is clicked', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ id: 43, description: 'Menu task' })] }))

    openMenu('Menu task')

    expect(menuOf('Menu task').open).toBe(true)
  })
})

describe('editing a task', () => {
  /** Opens a row's editor from its menu, as a user must. */
  function startEditing(description: string) {
    fireEvent.click(openMenu(description).getByRole('button', { name: /^edit$/i }))
    return within(screen.getByRole('form', { name: `Edit "${description}"` }))
  }

  it('saves a new description, due date and importance from the row menu', async () => {
    const fetchMock = stubApi({
      me: ALICE,
      tasks: [task({ id: 4, description: 'Renew the pasport' })],
      put: {
        status: 200,
        body: task({ id: 4, description: 'Renew the passport', dueDate: isoIn(5), importance: 'HIGH' }),
      },
    })
    await renderSignedIn(fetchMock)

    const editor = startEditing('Renew the pasport')
    fireEvent.change(editor.getByLabelText('Description'), { target: { value: 'Renew the passport' } })
    fireEvent.change(editor.getByLabelText('Due date'), { target: { value: isoIn(5) } })
    fireEvent.change(editor.getByLabelText('Importance'), { target: { value: 'HIGH' } })
    fireEvent.click(editor.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(screen.getByLabelText('Mark "Renew the passport" as done')).toBeInTheDocument())
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(String(put?.[0])).toMatch(/\/api\/tasks\/4$/)
    expect(bodyOf(fetchMock, 'PUT')).toEqual({
      description: 'Renew the passport',
      dueDate: isoIn(5),
      importance: 'HIGH',
      state: 'TODO',
    })
    expect(screen.queryByRole('form', { name: /^edit/i })).not.toBeInTheDocument()
  })

  it('starts with the task as it is, and the caret in the description', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ id: 5, description: 'Water the plants', importance: 'LOW' })] }))

    const editor = startEditing('Water the plants')

    expect(editor.getByLabelText('Description')).toHaveValue('Water the plants')
    expect(editor.getByLabelText('Due date')).toHaveValue(isoIn(1))
    expect(editor.getByLabelText('Importance')).toHaveValue('LOW')
    expect(editor.getByLabelText('Description')).toHaveFocus()
  })

  it('discards the changes on Cancel and on Escape, without asking the server', async () => {
    const fetchMock = stubApi({ me: ALICE, tasks: [task({ id: 6, description: 'Call the bank' })] })
    await renderSignedIn(fetchMock)

    let editor = startEditing('Call the bank')
    fireEvent.change(editor.getByLabelText('Description'), { target: { value: 'Something else' } })
    fireEvent.click(editor.getByRole('button', { name: /cancel/i }))
    expect(screen.getByLabelText('Mark "Call the bank" as done')).toBeInTheDocument()

    editor = startEditing('Call the bank')
    fireEvent.change(editor.getByLabelText('Description'), { target: { value: 'Something else' } })
    fireEvent.keyDown(editor.getByLabelText('Description'), { key: 'Escape' })
    expect(screen.getByLabelText('Mark "Call the bank" as done')).toBeInTheDocument()

    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('will not save an empty description', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ id: 7, description: 'Book the train' })] }))

    const editor = startEditing('Book the train')
    fireEvent.change(editor.getByLabelText('Description'), { target: { value: '   ' } })

    expect(editor.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  it('ignores Enter on an empty description too', async () => {
    const fetchMock = stubApi({ me: ALICE, tasks: [task({ id: 11, description: 'Book the hotel' })] })
    await renderSignedIn(fetchMock)

    startEditing('Book the hotel')
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '' } })
    fireEvent.submit(screen.getByRole('form', { name: 'Edit "Book the hotel"' }))

    expect(screen.getByRole('form', { name: 'Edit "Book the hotel"' })).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('keeps an overdue date, which only a new task may not have', async () => {
    const fetchMock = stubApi({
      me: ALICE,
      tasks: [task({ id: 8, description: 'File the taxes', dueDate: isoIn(-3) })],
      put: { status: 200, body: task({ id: 8, description: 'File the 2025 taxes', dueDate: isoIn(-3) }) },
    })
    await renderSignedIn(fetchMock)

    const editor = startEditing('File the taxes')
    expect(editor.getByLabelText('Due date')).not.toHaveAttribute('min')
    fireEvent.change(editor.getByLabelText('Description'), { target: { value: 'File the 2025 taxes' } })
    fireEvent.click(editor.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(screen.getByLabelText('Mark "File the 2025 taxes" as done')).toBeInTheDocument())
    expect(bodyOf(fetchMock, 'PUT')).toMatchObject({ dueDate: isoIn(-3) })
  })

  it('keeps the editor and what was typed when the save fails', async () => {
    await renderSignedIn(
      stubApi({ me: ALICE, tasks: [task({ id: 9, description: 'Fix the bike' })], put: { status: 500 } }),
    )

    const editor = startEditing('Fix the bike')
    fireEvent.change(editor.getByLabelText('Description'), { target: { value: 'Fix the bike brakes' } })
    fireEvent.click(editor.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(screen.getByText('Unable to update task.')).toBeInTheDocument())
    expect(screen.getByRole('form', { name: 'Edit "Fix the bike"' })).toBeInTheDocument()
    expect(screen.getByLabelText('Description')).toHaveValue('Fix the bike brakes')
  })

  it('offers no editing for a completed task', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ id: 10, description: 'Paid the rent', state: 'DONE' })] }))

    expect(openMenu('Paid the rent').queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
  })
})

describe('picking a due date from the calendar', () => {
  /** The ISO date of `day` in the month that `iso` falls in. */
  function dayOfMonth(iso: string, day: number) {
    return `${iso.slice(0, 8)}${String(day).padStart(2, '0')}`
  }

  it('opens from the date field and sets the day picked', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ id: 12, description: 'Plan the trip', dueDate: isoIn(1) })] }))
    fireEvent.click(openMenu('Plan the trip').getByRole('button', { name: /^edit$/i }))
    const editor = within(screen.getByRole('form', { name: 'Edit "Plan the trip"' }))

    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    fireEvent.click(editor.getByRole('button', { name: /choose the due date from a calendar/i }))
    const calendar = await findCalendar()
    fireEvent.click(within(calendar).getByText('15'))

    await waitFor(() => expect(screen.queryByRole('grid')).not.toBeInTheDocument())
    expect(editor.getByLabelText('Due date')).toHaveValue(dayOfMonth(isoIn(1), 15))
    expect(editor.getByRole('button', { name: /choose the due date from a calendar/i })).toHaveFocus()
  })

  it('closes on Escape without leaving the form or changing the date', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [task({ id: 13, description: 'Book a table', dueDate: isoIn(2) })] }))
    fireEvent.click(openMenu('Book a table').getByRole('button', { name: /^edit$/i }))
    const editor = within(screen.getByRole('form', { name: 'Edit "Book a table"' }))

    fireEvent.click(editor.getByRole('button', { name: /choose the due date from a calendar/i }))
    const calendar = await findCalendar()
    fireEvent.keyDown(calendar, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('grid')).not.toBeInTheDocument())
    expect(screen.getByRole('form', { name: 'Edit "Book a table"' })).toBeInTheDocument()
    expect(editor.getByLabelText('Due date')).toHaveValue(isoIn(2))
  })

  it('closes on a click outside it', async () => {
    await renderSignedIn(stubApi({ me: ALICE }))
    startAdding('Something new')

    fireEvent.click(screen.getByRole('button', { name: /choose the due date from a calendar/i }))
    await findCalendar()
    fireEvent.click(document.body)

    await waitFor(() => expect(screen.queryByRole('grid')).not.toBeInTheDocument())
  })

  it('offers no day before today when adding, as the backend refuses one', async () => {
    await renderSignedIn(stubApi({ me: ALICE }))
    startAdding('Something new')

    fireEvent.click(screen.getByRole('button', { name: /choose the due date from a calendar/i }))
    const calendar = await findCalendar()

    const yesterday = within(calendar).queryByRole('button', { name: new RegExp(dayLabel(isoIn(-1))) })
    // Yesterday is only on screen when it falls in the month shown, which starts at tomorrow.
    if (yesterday) {
      expect(yesterday).toBeDisabled()
    }
    expect(within(calendar).getByRole('button', { name: new RegExp(dayLabel(isoIn(1))) })).toBeEnabled()
  })
})

/** The words react-day-picker puts in a day's label, e.g. "October 6th, 2026". */
function dayLabel(iso: string) {
  const [year, month, day] = iso.split('-').map(Number)
  const monthName = new Date(year, month - 1, day).toLocaleString('en-US', { month: 'long' })
  const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th'
  return `${monthName} ${day}${suffix}, ${year}`
}
