import { act, render, screen, userEvent, within } from '@testing-library/react-native'
import { RequestFailedError, SignedOutError, type BoardTask } from './api'
import type { Session } from './session'
import type { SessionStore } from './staySignedIn'
import { TaskFestApp, type Dependencies, type TaskChanges } from './TaskFestApp'
import { variants } from './variants'

jest.mock('./DueDatePicker', () => ({ DueDatePicker: () => null }))

const NOW = Date.UTC(2026, 9, 10, 9)
const TODAY = '2026-10-10'
const HOUR = 3600 * 1000
const BASE = 'http://localhost:3000'

const session: Session = { idToken: 'stored', refreshToken: 'r', expiresAt: NOW + HOUR, lastUsedAt: NOW }

const water: BoardTask = { id: 1, description: 'Water the plants', dueDate: TODAY, importance: 'HIGH', state: 'TODO' }
const train: BoardTask = { id: 2, description: 'Book the train', dueDate: '2026-10-11', importance: 'LOW', state: 'WORKING' }
const rent: BoardTask = { id: 3, description: 'Pay the rent', dueDate: '2026-10-01', importance: 'MEDIUM', state: 'DONE' }

function memorySessions(initial: Session | null): SessionStore & { current: () => Session | null } {
  let stored = initial
  return {
    current: () => stored,
    save: async (next) => void (stored = next),
    load: async () => stored,
    clear: async () => void (stored = null),
  }
}

function backend(overrides: Partial<TaskChanges> = {}): TaskChanges {
  return {
    create: jest.fn(async (_caller, input) => ({ ...input, id: 10 })),
    update: jest.fn(async (_caller, task) => task),
    remove: jest.fn().mockResolvedValue(undefined),
    restore: jest.fn(async (_caller, task) => ({ ...task, id: task.id + 100 })),
    ...overrides,
  }
}

function dependencies(changes: TaskChanges, overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    sessions: memorySessions(session),
    provider: { signIn: jest.fn(), refresh: jest.fn() },
    fetchTasks: jest.fn().mockResolvedValue([water, train, rent]),
    fetchMinimumAppVersion: jest.fn().mockResolvedValue('0.0.0'),
    appVersion: '1.2.0',
    now: () => NOW,
    changes,
    ...overrides,
  }
}

async function showBoard(changes: TaskChanges, overrides: Partial<Dependencies> = {}) {
  await render(<TaskFestApp variant={variants.dev} language="en" dependencies={dependencies(changes, overrides)} />)
  await screen.findByText('Water the plants')
  return userEvent.setup()
}

describe('changing the board from the app (#271)', () => {
  it('adds a task, which the board shows once the backend has it', async () => {
    const changes = backend()
    const user = await showBoard(changes)

    await user.press(screen.getByRole('button', { name: 'Add a task' }))
    await user.type(screen.getByLabelText('What needs doing'), 'Renew the passport')
    await user.press(screen.getByRole('button', { name: 'Add' }))

    expect(changes.create).toHaveBeenCalledWith(
      { baseUrl: BASE, idToken: 'stored' },
      { description: 'Renew the passport', dueDate: '2026-10-11', importance: 'MEDIUM', state: 'TODO' },
    )
    expect(await screen.findByText('Renew the passport')).toBeOnTheScreen()
    expect(screen.queryByLabelText('What needs doing')).toBeNull()
  })

  it('keeps the form open, with what was typed, when the backend refuses the task', async () => {
    const changes = backend({ create: jest.fn().mockRejectedValue(new RequestFailedError(400)) })
    const user = await showBoard(changes)

    await user.press(screen.getByRole('button', { name: 'Add a task' }))
    await user.type(screen.getByLabelText('What needs doing'), 'Renew the passport')
    await user.press(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText('Unable to create task.')).toBeOnTheScreen()
    expect(screen.getByLabelText('What needs doing')).toHaveDisplayValue('Renew the passport')
  })

  it('goes back to the board without adding anything', async () => {
    const changes = backend()
    const user = await showBoard(changes)

    await user.press(screen.getByRole('button', { name: 'Add a task' }))
    await user.press(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText('What needs doing')).toBeNull()
    expect(changes.create).not.toHaveBeenCalled()
  })

  it('renews a session about to run out before it sends a change', async () => {
    const fresh = `h.${btoa(JSON.stringify({ exp: (NOW + HOUR) / 1000 })).replace(/=+$/, '')}.s`
    const refresh = jest.fn().mockResolvedValue({ idToken: fresh, refreshToken: 'r2' })
    const sessions = memorySessions({ ...session, expiresAt: NOW + 1000 })
    const fetchTasks = jest.fn().mockResolvedValue([water])
    const changes = backend()
    const user = await showBoard(changes, { sessions, fetchTasks, provider: { signIn: jest.fn(), refresh } })

    await user.press(screen.getByRole('checkbox', { name: 'Mark "Water the plants" as done' }))

    expect(changes.update).toHaveBeenCalledWith({ baseUrl: BASE, idToken: fresh }, expect.anything())
  })

  it('asks for a sign-in again when the backend no longer accepts the session', async () => {
    const changes = backend({ create: jest.fn().mockRejectedValue(new SignedOutError()) })
    const sessions = memorySessions(session)
    const user = await showBoard(changes, { sessions })

    await user.press(screen.getByRole('button', { name: 'Add a task' }))
    await user.type(screen.getByLabelText('What needs doing'), 'Renew the passport')
    await user.press(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText('Your session has expired. Sign in again to carry on.')).toBeOnTheScreen()
    expect(sessions.current()).toBeNull()
  })

  it('asks for a sign-in again when the session ended while the board was open', async () => {
    const sessions = memorySessions(session)
    const changes = backend()
    const user = await showBoard(changes, { sessions })
    await sessions.clear()

    await user.press(screen.getByRole('button', { name: 'Edit "Book the train"' }))
    await user.press(screen.getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('Your session has expired. Sign in again to carry on.')).toBeOnTheScreen()
    expect(changes.remove).not.toHaveBeenCalled()
  })

  it('edits a task, the board showing it once saved', async () => {
    const changes = backend()
    const user = await showBoard(changes)

    await user.press(screen.getByRole('button', { name: 'Edit "Book the train"' }))
    await user.clear(screen.getByLabelText('Description'))
    await user.type(screen.getByLabelText('Description'), 'Book the night train')
    await user.press(screen.getByRole('button', { name: 'Save' }))

    expect(changes.update).toHaveBeenCalledWith(
      { baseUrl: BASE, idToken: 'stored' },
      { ...train, description: 'Book the night train' },
    )
    expect(await screen.findByText('Book the night train')).toBeOnTheScreen()
    expect(screen.queryByText('Book the train')).toBeNull()
  })

  it('says so when an edit cannot be saved', async () => {
    const changes = backend({ update: jest.fn().mockRejectedValue(new RequestFailedError(500)) })
    const user = await showBoard(changes)

    await user.press(screen.getByRole('button', { name: 'Edit "Book the train"' }))
    await user.press(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Unable to update task.')).toBeOnTheScreen()
  })

  it('completes a task at once, and keeps it done once the backend agrees', async () => {
    const changes = backend()
    const user = await showBoard(changes)

    await user.press(screen.getByRole('checkbox', { name: 'Mark "Water the plants" as done' }))

    expect(changes.update).toHaveBeenCalledWith(expect.anything(), { ...water, state: 'DONE' })
    expect(await screen.findByText('Completed (2)')).toBeOnTheScreen()
  })

  it('opens a completed task again', async () => {
    const changes = backend()
    const user = await showBoard(changes)

    await user.press(screen.getByRole('checkbox', { name: 'Mark "Pay the rent" as done', checked: true }))

    expect(changes.update).toHaveBeenCalledWith(expect.anything(), { ...rent, state: 'TODO' })
    expect(await screen.findByText('Overdue')).toBeOnTheScreen()
  })

  it('takes a completion back when the backend refuses it, and says so', async () => {
    const changes = backend({ update: jest.fn().mockRejectedValue(new RequestFailedError(500)) })
    const user = await showBoard(changes)

    await user.press(screen.getByRole('checkbox', { name: 'Mark "Water the plants" as done' }))

    expect(await screen.findByText('Unable to update task.')).toBeOnTheScreen()
    expect(screen.getByText('Completed (1)')).toBeOnTheScreen()
    expect(screen.getByRole('checkbox', { name: 'Mark "Water the plants" as done', checked: false })).toBeOnTheScreen()
  })

  it('deletes a task and offers to put it back', async () => {
    const changes = backend()
    const user = await showBoard(changes)

    await user.press(screen.getByRole('button', { name: 'Edit "Book the train"' }))
    await user.press(screen.getByRole('button', { name: 'Delete' }))

    expect(changes.remove).toHaveBeenCalledWith({ baseUrl: BASE, idToken: 'stored' }, train)
    expect(screen.queryByText('Book the train')).toBeNull()
    expect(screen.getByText('Task deleted')).toBeOnTheScreen()

    await user.press(screen.getByRole('button', { name: 'Undo' }))

    expect(changes.restore).toHaveBeenCalledWith({ baseUrl: BASE, idToken: 'stored' }, train, TODAY)
    expect(await screen.findByText('Book the train')).toBeOnTheScreen()
    expect(screen.queryByText('Task deleted')).toBeNull()
  })

  it('puts a task back when the backend refuses to delete it, and says so', async () => {
    const changes = backend({ remove: jest.fn().mockRejectedValue(new RequestFailedError(500)) })
    const user = await showBoard(changes)

    await user.press(screen.getByRole('button', { name: 'Edit "Book the train"' }))
    await user.press(screen.getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('Unable to delete task.')).toBeOnTheScreen()
    expect(screen.getByText('Book the train')).toBeOnTheScreen()
    expect(screen.queryByText('Task deleted')).toBeNull()
  })

  it('says so when a deleted task cannot be put back', async () => {
    const changes = backend({ restore: jest.fn().mockRejectedValue(new RequestFailedError(500)) })
    const user = await showBoard(changes)

    await user.press(screen.getByRole('button', { name: 'Edit "Book the train"' }))
    await user.press(screen.getByRole('button', { name: 'Delete' }))
    await user.press(screen.getByRole('button', { name: 'Undo' }))

    expect(await screen.findByText('Unexpected error while restoring data.')).toBeOnTheScreen()
  })

  it('withdraws the offer to undo after a few seconds, or when dismissed', async () => {
    jest.useFakeTimers()
    try {
      const changes = backend()
      const user = await showBoard(changes)

      await user.press(screen.getByRole('button', { name: 'Edit "Book the train"' }))
      await user.press(screen.getByRole('button', { name: 'Delete' }))
      expect(screen.getByText('Task deleted')).toBeOnTheScreen()

      await act(async () => jest.advanceTimersByTime(8000))

      expect(screen.queryByText('Task deleted')).toBeNull()

      await user.press(screen.getByRole('button', { name: 'Edit "Water the plants"' }))
      await user.press(screen.getByRole('button', { name: 'Delete' }))
      await user.press(screen.getByRole('button', { name: 'Dismiss' }))

      expect(screen.queryByText('Task deleted')).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })

  it('clears the completed tasks, and offers to put them back', async () => {
    const done = { ...water, id: 4, description: 'Post the letter', state: 'DONE' as const }
    const changes = backend()
    const user = await showBoard(changes, { fetchTasks: jest.fn().mockResolvedValue([water, rent, done]) })

    await user.press(screen.getByRole('button', { name: 'Clear completed' }))

    expect(changes.remove).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Pay the rent')).toBeNull()
    expect(screen.getByText('2 tasks deleted')).toBeOnTheScreen()

    await user.press(screen.getByRole('button', { name: 'Undo' }))

    expect(await screen.findByText('Pay the rent')).toBeOnTheScreen()
    expect(screen.getByText('Post the letter')).toBeOnTheScreen()
  })

  it('leaves a task with a value it does not know as it is: changing it would overwrite that value', async () => {
    const newer: BoardTask = { ...rent, unknown: ['importance'] }
    const changes = backend()
    const user = await showBoard(changes, { fetchTasks: jest.fn().mockResolvedValue([water, newer]) })

    const row = screen.getByTestId(`task-${newer.id}`)
    expect(within(row).getByText('Update the app to change this task.')).toBeOnTheScreen()
    expect(within(row).queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit "Pay the rent"' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Clear completed' })).toBeNull()
    await user.press(screen.getByText('Pay the rent'))
    expect(screen.queryByLabelText('Description')).toBeNull()
  })

  it('offers to add the first task on an empty board', async () => {
    const changes = backend()
    await render(
      <TaskFestApp
        variant={variants.dev}
        language="en"
        dependencies={dependencies(changes, { fetchTasks: jest.fn().mockResolvedValue([]) })}
      />,
    )

    expect(await screen.findByText('Nothing here yet.')).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Add a task' })).toBeOnTheScreen()
  })
})
