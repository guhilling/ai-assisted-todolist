import { render, screen, userEvent } from '@testing-library/react-native'
import type { BoardTask } from './api'
import { stylesFor } from './styles'
import { TaskForm } from './TaskForm'
import { light } from './theme'
import { catalogues } from './web'

// The platform's picker is native; this one picks Christmas, and says how early it would go.
jest.mock('./DueDatePicker', () => {
  const { createElement } = require('react')
  const { Pressable, Text } = require('react-native')
  return {
    DueDatePicker: ({ onPick, minimum }: { onPick: (iso: string | null) => void; minimum?: string }) =>
      createElement(
        Pressable,
        { accessibilityRole: 'button', onPress: () => onPick('2026-12-24') },
        createElement(Text, null, `Pick Christmas, from ${minimum ?? 'any day'}`),
      ),
  }
})

const TODAY = '2026-10-10'
const styles = stylesFor(light)
const task: BoardTask = { id: 4, description: 'Book the train', dueDate: '2026-10-11', importance: 'LOW', state: 'TODO' }

function form(props: Partial<Parameters<typeof TaskForm>[0]> = {}) {
  return (
    <TaskForm
      today={TODAY}
      language="en"
      messages={catalogues.en}
      styles={styles}
      theme={light}
      onSave={jest.fn().mockResolvedValue(true)}
      onCancel={jest.fn()}
      {...props}
    />
  )
}

describe('the task form (#271)', () => {
  it('adds a task due tomorrow, of medium importance, unless told otherwise', async () => {
    const onSave = jest.fn().mockResolvedValue(true)
    await render(form({ onSave }))
    const user = userEvent.setup()

    expect(screen.getByText('Add a task')).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Tomorrow', selected: true })).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Medium', selected: true })).toBeOnTheScreen()
    await user.type(screen.getByLabelText('What needs doing'), '  Water the plants ')
    await user.press(screen.getByRole('button', { name: 'Add' }))

    expect(onSave).toHaveBeenCalledWith({
      description: 'Water the plants',
      dueDate: '2026-10-11',
      importance: 'MEDIUM',
      state: 'TODO',
    })
  })

  it('takes the date and importance chosen', async () => {
    const onSave = jest.fn().mockResolvedValue(true)
    await render(form({ onSave }))
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('What needs doing'), 'Renew the passport')
    await user.press(screen.getByRole('button', { name: 'In 2 weeks' }))
    await user.press(screen.getByRole('button', { name: 'High' }))
    await user.press(screen.getByRole('button', { name: 'Add' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dueDate: '2026-10-24', importance: 'HIGH' }))
  })

  it('cannot add a task without a description', async () => {
    const onSave = jest.fn()
    await render(form({ onSave }))
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('What needs doing'), '   ')
    await user.press(screen.getByRole('button', { name: 'Add' }))

    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('picks any other day from the platform’s calendar, no earlier than today for a new task', async () => {
    const onSave = jest.fn().mockResolvedValue(true)
    await render(form({ onSave }))
    const user = userEvent.setup()

    await user.press(screen.getByRole('button', { name: 'Other date' }))
    await user.press(screen.getByRole('button', { name: `Pick Christmas, from ${TODAY}` }))
    await user.type(screen.getByLabelText('What needs doing'), 'Wrap the presents')
    await user.press(screen.getByRole('button', { name: 'Add' }))

    expect(screen.getByRole('button', { name: '24 Dec', selected: true })).toBeOnTheScreen()
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dueDate: '2026-12-24' }))
  })

  it('edits every field of a task, the state included', async () => {
    const onSave = jest.fn().mockResolvedValue(true)
    await render(form({ task, onSave, onDelete: jest.fn() }))
    const user = userEvent.setup()

    expect(screen.getByText('Edit "Book the train"')).toBeOnTheScreen()
    expect(screen.getByLabelText('Description')).toHaveDisplayValue('Book the train')
    await user.clear(screen.getByLabelText('Description'))
    await user.type(screen.getByLabelText('Description'), 'Book the night train')
    await user.press(screen.getByRole('button', { name: 'Today' }))
    await user.press(screen.getByRole('button', { name: 'High' }))
    await user.press(screen.getByRole('button', { name: 'In progress' }))
    await user.press(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledWith({
      description: 'Book the night train',
      dueDate: TODAY,
      importance: 'HIGH',
      state: 'WORKING',
    })
  })

  it('lets an edit date a task anywhere, the past included', async () => {
    await render(form({ task, onDelete: jest.fn() }))

    await userEvent.setup().press(screen.getByRole('button', { name: 'Other date' }))

    expect(screen.getByText('Pick Christmas, from any day')).toBeOnTheScreen()
  })

  it('shows a date that is not a shortcut as the chosen one', async () => {
    await render(form({ task: { ...task, dueDate: '2026-11-30' }, onDelete: jest.fn() }))

    expect(screen.getByRole('button', { name: '30 Nov', selected: true })).toBeOnTheScreen()
  })

  it('keeps what was typed while it saves, and when the save fails', async () => {
    let finish: (saved: boolean) => void = () => undefined
    const onSave = jest.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
    const view = await render(form({ onSave }))
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('What needs doing'), 'Water the plants')
    await user.press(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled()

    finish(false)
    await view.rerender(form({ onSave, failure: 'Unable to create task.' }))

    expect(await screen.findByText('Unable to create task.')).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled()
    expect(screen.getByLabelText('What needs doing')).toHaveDisplayValue('Water the plants')
  })

  it('deletes the task being edited, or goes back without saving', async () => {
    const onDelete = jest.fn()
    const onCancel = jest.fn()
    await render(form({ task, onDelete, onCancel }))
    const user = userEvent.setup()

    await user.press(screen.getByRole('button', { name: 'Delete' }))
    await user.press(screen.getByRole('button', { name: 'Cancel' }))

    expect(onDelete).toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalled()
  })

  it('offers no delete for a task not yet added', async () => {
    await render(form())

    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(screen.queryByText('State')).toBeNull()
  })

  it('speaks German', async () => {
    await render(form({ language: 'de', messages: catalogues.de, task, onDelete: jest.fn() }))

    expect(screen.getByRole('button', { name: 'Speichern' })).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'In Arbeit' })).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Anderes Datum' })).toBeOnTheScreen()
  })
})
