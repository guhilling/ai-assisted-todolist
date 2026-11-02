/**
 * A task's due time on the website (#476): setting one while adding and editing, the switch that
 * ties it to a time zone, clearing it, and how a row shows it.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { stubApi } from './testing/api'
import { ALICE, bodyOf, isoIn, openMenu, renderSignedIn, rowFor, startAdding, task } from './testing/board'

/** The zone this browser is in, which the switch starts from. */
const HERE = Intl.DateTimeFormat().resolvedOptions().timeZone

function startEditing(description: string) {
  fireEvent.click(openMenu(description).getByRole('button', { name: /^edit$/i }))
  return within(screen.getByRole('form', { name: `Edit "${description}"` }))
}

describe('adding a task with a due time', () => {
  it('offers the zone switch only once there is a time, off by default', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [] }))

    startAdding('Call the office')
    expect(screen.queryByRole('switch', { name: 'Tied to a time zone' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '10:00' } })
    const tied = screen.getByRole('switch', { name: 'Tied to a time zone' })
    expect(tied).not.toBeChecked()
    expect(screen.queryByLabelText('Time zone')).not.toBeInTheDocument()
  })

  it('adds a floating time', async () => {
    const fetchMock = stubApi({ me: ALICE, tasks: [], echoPost: true })
    await renderSignedIn(fetchMock)

    startAdding('Take the pills')
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '08:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(bodyOf(fetchMock, 'POST')).toMatchObject({ dueTime: '08:00' }))
    expect(bodyOf(fetchMock, 'POST').timeZone).toBeUndefined()
  })

  it("ties a time to the browser's zone, which can be changed", async () => {
    const fetchMock = stubApi({ me: ALICE, tasks: [], echoPost: true })
    await renderSignedIn(fetchMock)

    startAdding('Call the office')
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '10:00' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Tied to a time zone' }))
    expect(screen.getByLabelText('Time zone')).toHaveValue(HERE)

    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'America/New_York' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(bodyOf(fetchMock, 'POST')).toMatchObject({ dueTime: '10:00', timeZone: 'America/New_York' }),
    )
  })

  it('drops the zone with the time', async () => {
    const fetchMock = stubApi({ me: ALICE, tasks: [], echoPost: true })
    await renderSignedIn(fetchMock)

    startAdding('Changed my mind')
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '10:00' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Tied to a time zone' }))
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '' } })
    expect(screen.queryByRole('switch', { name: 'Tied to a time zone' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(bodyOf(fetchMock, 'POST')).toMatchObject({ description: 'Changed my mind' }))
    expect(bodyOf(fetchMock, 'POST').dueTime).toBeUndefined()
    expect(bodyOf(fetchMock, 'POST').timeZone).toBeUndefined()
  })
})

describe('editing a due time', () => {
  const zoned = { ...task({ id: 7, description: 'Meet Berlin' }), dueTime: '10:00', timeZone: 'Europe/Berlin' }

  it('starts with the time and zone the task has', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [zoned] }))

    const editor = startEditing('Meet Berlin')
    expect(editor.getByLabelText('Time')).toHaveValue('10:00')
    expect(editor.getByRole('switch', { name: 'Tied to a time zone' })).toBeChecked()
    expect(editor.getByLabelText('Time zone')).toHaveValue('Europe/Berlin')
  })

  it('clears the time and the zone with null, which the backend would otherwise keep (#497)', async () => {
    const fetchMock = stubApi({ me: ALICE, tasks: [zoned], put: { status: 200, body: { ...zoned, dueTime: null, timeZone: null } } })
    await renderSignedIn(fetchMock)

    const editor = startEditing('Meet Berlin')
    fireEvent.change(editor.getByLabelText('Time'), { target: { value: '' } })
    fireEvent.click(editor.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(bodyOf(fetchMock, 'PUT')).toMatchObject({ dueTime: null, timeZone: null }))
  })

  it('makes a zoned time floating when the switch is turned off', async () => {
    const fetchMock = stubApi({ me: ALICE, tasks: [zoned], put: { status: 200, body: { ...zoned, timeZone: null } } })
    await renderSignedIn(fetchMock)

    const editor = startEditing('Meet Berlin')
    fireEvent.click(editor.getByRole('switch', { name: 'Tied to a time zone' }))
    fireEvent.click(editor.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(bodyOf(fetchMock, 'PUT')).toMatchObject({ dueTime: '10:00', timeZone: null }))
  })

  it('gives a task its own zone back when the switch goes off and on again', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [zoned] }))

    const editor = startEditing('Meet Berlin')
    fireEvent.click(editor.getByRole('switch', { name: 'Tied to a time zone' }))
    fireEvent.click(editor.getByRole('switch', { name: 'Tied to a time zone' }))

    expect(editor.getByLabelText('Time zone')).toHaveValue('Europe/Berlin')
  })

  it('keeps the zone while a part of the time is typed again', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [zoned] }))

    const editor = startEditing('Meet Berlin')
    const time = editor.getByLabelText('Time') as HTMLInputElement
    // What a browser reports while the minutes are typed again: no value, and bad input.
    Object.defineProperty(time, 'validity', { value: { badInput: true }, configurable: true })
    fireEvent.change(time, { target: { value: '' } })

    expect(editor.getByLabelText('Time zone')).toHaveValue('Europe/Berlin')
  })

  it('gives the zone back when a cleared time is set again', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [zoned] }))

    const editor = startEditing('Meet Berlin')
    fireEvent.change(editor.getByLabelText('Time'), { target: { value: '' } })
    fireEvent.change(editor.getByLabelText('Time'), { target: { value: '11:00' } })
    fireEvent.click(editor.getByRole('switch', { name: 'Tied to a time zone' }))

    expect(editor.getByLabelText('Time zone')).toHaveValue('Europe/Berlin')
  })

  it('gives an all-day task a time', async () => {
    const plain = task({ id: 8, description: 'Water the plants' })
    const fetchMock = stubApi({ me: ALICE, tasks: [plain], put: { status: 200, body: { ...plain, dueTime: '18:30' } } })
    await renderSignedIn(fetchMock)

    const editor = startEditing('Water the plants')
    expect(editor.getByLabelText('Time')).toHaveValue('')
    fireEvent.change(editor.getByLabelText('Time'), { target: { value: '18:30' } })
    fireEvent.click(editor.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(bodyOf(fetchMock, 'PUT')).toMatchObject({ dueTime: '18:30', timeZone: null }))
  })
})

describe('a due time on a row', () => {
  it('shows a floating time as it is', async () => {
    const floating = { ...task({ description: 'Take the pills', dueDate: isoIn(0) }), dueTime: '08:00' }
    await renderSignedIn(stubApi({ me: ALICE, tasks: [floating] }))

    expect(within(rowFor('Take the pills')).getByText('08:00')).toBeInTheDocument()
  })

  it('shows a zoned time there and here, filed under its own date', async () => {
    const dueDate = isoIn(5)
    const [year, month, day] = dueDate.split('-').map(Number)
    // 04:00 here on the task's day, whatever zone the tests run in.
    const dueAt = new Date(year, month - 1, day, 4, 0).toISOString()
    const zoned = { ...task({ description: 'Meet Berlin', dueDate }), dueTime: '10:00', timeZone: 'Europe/Berlin', dueAt }
    await renderSignedIn(stubApi({ me: ALICE, tasks: [zoned] }))

    expect(within(rowFor('Meet Berlin')).getByText('10:00 (Berlin), 04:00 here')).toBeInTheDocument()
  })
})
