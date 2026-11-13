/**
 * The due date and time on a desktop (#588): one date picker, TaskFest's calendar, where Safari
 * and Firefox would open one of their own beside it; a list to pick a time from, which desktop
 * Safari and Firefox do not offer; and the zone switch from the start. A phone keeps its own
 * pickers, as jsdom's absent pointer stands for in every other test.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubApi } from './testing/api'
import { ALICE, bodyOf, isoIn, renderSignedIn, startAdding } from './testing/board'
import { typedDate } from './dates'

/** A desktop: a mouse or trackpad, whose pointer is fine. */
function onDesktop() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(pointer: fine)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

beforeEach(() => {
  onDesktop()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the due date on a desktop', () => {
  it("is a text field in the language's own form, so no browser opens a picker of its own", async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [] }))
    startAdding('Water the plants')

    const date = screen.getByLabelText('Due date') as HTMLInputElement
    expect(date).toHaveAttribute('type', 'text')
    expect(date).toHaveValue(typedDate(isoIn(1), 'en-GB'))
    expect(date).toHaveAttribute('placeholder', 'dd/mm/yyyy')
    expect(screen.getByRole('button', { name: 'Choose the due date from a calendar' })).toBeInTheDocument()
  })

  it('takes a typed date and sends it as the date it is', async () => {
    const fetchMock = stubApi({ me: ALICE, tasks: [], echoPost: true })
    await renderSignedIn(fetchMock)
    startAdding('Water the plants')

    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: typedDate(isoIn(9), 'en-GB') } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(bodyOf(fetchMock, 'POST')).toMatchObject({ dueDate: isoIn(9) }))
  })

  it('refuses a date it cannot read, or one in the past, and says how to write one', async () => {
    const fetchMock = stubApi({ me: ALICE, tasks: [], echoPost: true })
    await renderSignedIn(fetchMock)
    startAdding('Water the plants')
    const date = screen.getByLabelText('Due date') as HTMLInputElement

    fireEvent.change(date, { target: { value: '31/02/2027' } })
    expect(date.validationMessage).toBe(`Enter a date such as ${typedDate(isoIn(1), 'en-GB')}.`)

    fireEvent.change(date, { target: { value: typedDate(isoIn(-1), 'en-GB') } })
    expect(date.validationMessage).toBe('Pick today or a later date.')

    fireEvent.change(date, { target: { value: typedDate(isoIn(2), 'en-GB') } })
    expect(date.validationMessage).toBe('')
  })

  it('shows a date picked from the shortcuts in the same form', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [] }))
    startAdding('Water the plants')

    fireEvent.click(screen.getByRole('button', { name: 'In 1 week' }))

    expect(screen.getByLabelText('Due date')).toHaveValue(typedDate(isoIn(7), 'en-GB'))
  })
})

describe('the due time on a desktop', () => {
  it('is picked from a list in steps of 15 minutes, which gives the focus back', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [] }))
    startAdding('Call the office')
    const toggle = screen.getByRole('button', { name: 'Choose the time from a list' })

    fireEvent.click(toggle)
    const list = screen.getByRole('listbox', { name: 'Time' })
    const options = within(list).getAllByRole('option')
    expect(options).toHaveLength(96)
    expect(options[0]).toHaveTextContent('00:00')
    expect(options[95]).toHaveTextContent('23:45')

    fireEvent.click(within(list).getByRole('option', { name: '09:15' }))

    expect(screen.getByLabelText('Time')).toHaveValue('09:15')
    expect(screen.queryByRole('listbox', { name: 'Time' })).not.toBeInTheDocument()
    expect(toggle).toHaveFocus()
  })

  it('opens at the time set, and moves with the arrow keys', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [] }))
    startAdding('Call the office')
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '14:30' } })

    fireEvent.click(screen.getByRole('button', { name: 'Choose the time from a list' }))
    const list = screen.getByRole('listbox', { name: 'Time' })
    expect(within(list).getByRole('option', { name: '14:30' })).toHaveFocus()

    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(within(list).getByRole('option', { name: '14:45' })).toHaveFocus()
    fireEvent.keyDown(list, { key: 'ArrowUp' })
    fireEvent.keyDown(list, { key: 'ArrowUp' })
    expect(within(list).getByRole('option', { name: '14:15' })).toHaveFocus()
  })

  it('closes the list on Escape without closing the form', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [] }))
    startAdding('Call the office')

    fireEvent.click(screen.getByRole('button', { name: 'Choose the time from a list' }))
    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Time' }), { key: 'Escape' })

    expect(screen.queryByRole('listbox', { name: 'Time' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('What needs doing')).toBeInTheDocument()
  })

  it('still takes any minute typed', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [] }))
    startAdding('Call the office')

    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:07' } })

    expect(screen.getByLabelText('Time')).toHaveValue('09:07')
  })
})

describe('the time zone switch', () => {
  it('ties a task without a time to a zone by giving it 09:00, so a zone is never sent alone', async () => {
    const fetchMock = stubApi({ me: ALICE, tasks: [], echoPost: true })
    await renderSignedIn(fetchMock)
    startAdding('Call Berlin')

    fireEvent.click(screen.getByRole('switch', { name: 'Tied to a time zone' }))
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'Europe/Berlin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(bodyOf(fetchMock, 'POST')).toMatchObject({ dueTime: '09:00', timeZone: 'Europe/Berlin' }),
    )
  })
})
