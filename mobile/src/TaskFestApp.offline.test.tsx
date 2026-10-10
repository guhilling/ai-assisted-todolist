import { act, render, screen, userEvent } from '@testing-library/react-native'
import { AppState } from 'react-native'
import { SignedOutError, type BoardTask } from './api'
import type { KeptBoard, KeptBoardStore } from './keptBoard'
import type { Session } from './session'
import type { SessionStore } from './staySignedIn'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import { variants } from './variants'
import type { Language } from './web'

jest.mock('./DueDatePicker', () => ({ DueDatePicker: () => null }))

const NOW = Date.UTC(2026, 9, 10, 9)
const HOUR = 3600 * 1000
const OFFLINE = /^No connection\. These are your tasks as of .+, and they may not be current\.$/

function tokenWith(payload: object) {
  const encoded = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${encoded}.signature`
}

const idToken = tokenWith({ exp: NOW / 1000 + 3600, email: 'ada@example.com' })
const session: Session = { idToken, refreshToken: 'r', expiresAt: NOW + HOUR, lastUsedAt: NOW }
const water: BoardTask = { id: 1, description: 'Water the plants', dueDate: '2026-10-10', importance: 'HIGH', state: 'TODO' }
const train: BoardTask = { id: 2, description: 'Book the train', dueDate: '2026-10-11', importance: 'LOW', state: 'TODO' }
const kept: KeptBoard = { account: 'ada@example.com', savedAt: NOW - HOUR, tasks: [water] }

function memorySessions(initial: Session | null): SessionStore & { current: () => Session | null } {
  let stored = initial
  return {
    current: () => stored,
    save: async (next) => void (stored = next),
    load: async () => stored,
    clear: async () => void (stored = null),
  }
}

function memoryBoard(initial: KeptBoard | null): KeptBoardStore & { current: () => KeptBoard | null } {
  let stored = initial
  return {
    current: () => stored,
    load: async () => stored,
    save: jest.fn(async (board: KeptBoard) => void (stored = board)),
    clear: async () => void (stored = null),
  }
}

/** A load that never answers: the network has not got back yet. */
const pending = () => new Promise<BoardTask[]>(() => undefined)
const noConnection = () => Promise.reject(new TypeError('Network request failed'))

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    sessions: memorySessions(session),
    provider: { signIn: jest.fn(), refresh: jest.fn() },
    fetchTasks: jest.fn().mockResolvedValue([water, train]),
    fetchMinimumAppVersion: jest.fn().mockResolvedValue('0.0.0'),
    changes: { create: jest.fn(), update: jest.fn(async (_caller, task) => task), remove: jest.fn(), restore: jest.fn() },
    deleteAccount: jest.fn().mockResolvedValue(undefined),
    keptBoard: memoryBoard(null),
    appVersion: '1.2.0',
    now: () => NOW,
    ...overrides,
  }
}

async function start(overrides: Partial<Dependencies> = {}, language: Language = 'en') {
  const deps = dependencies(overrides)
  await render(<TaskFestApp variant={variants.dev} language={language} dependencies={deps} />)
  return { deps, user: userEvent.setup() }
}

describe('the board kept on the phone (#272)', () => {
  it('keeps every board it loads, for the account it belongs to', async () => {
    const keptBoard = memoryBoard(null)
    await start({ keptBoard })

    await screen.findByText('Book the train')

    expect(keptBoard.current()).toEqual({ account: 'ada@example.com', savedAt: NOW, tasks: [water, train] })
  })

  it('shows the kept board at once, before the network answers', async () => {
    await start({ keptBoard: memoryBoard(kept), fetchTasks: jest.fn(pending) })

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
    expect(screen.getByText('Loading tasks…')).toBeOnTheScreen()
  })

  it('replaces the kept board with the loaded one, and keeps that', async () => {
    const keptBoard = memoryBoard(kept)
    await start({ keptBoard })

    expect(await screen.findByText('Book the train')).toBeOnTheScreen()
    expect(screen.queryByText('Loading tasks…')).toBeNull()
    expect(keptBoard.current()?.tasks).toEqual([water, train])
  })

  it('shows the kept board without a connection, saying it may not be current', async () => {
    await start({ keptBoard: memoryBoard(kept), fetchTasks: jest.fn(noConnection) })

    expect(await screen.findByText(OFFLINE)).toBeOnTheScreen()
    expect(screen.getByText('Water the plants')).toBeOnTheScreen()
  })

  it('says when the kept board is from, in the user’s language', async () => {
    await start({ keptBoard: memoryBoard(kept), fetchTasks: jest.fn(noConnection) }, 'de')

    expect(
      await screen.findByText(/^Keine Verbindung\. Das sind deine Aufgaben, Stand .+; sie sind vielleicht nicht mehr aktuell\.$/),
    ).toBeOnTheScreen()
  })

  it('shows the kept board when the sign-in cannot be renewed for want of a connection', async () => {
    const expiring = { ...session, expiresAt: NOW }
    const refresh = jest.fn().mockRejectedValue(new TypeError('Network request failed'))
    await start({ sessions: memorySessions(expiring), keptBoard: memoryBoard(kept), provider: { signIn: jest.fn(), refresh } })

    expect(await screen.findByText(OFFLINE)).toBeOnTheScreen()
    expect(screen.getByText('Water the plants')).toBeOnTheScreen()
  })

  it('loads again when asked, and drops the note once it has', async () => {
    const fetchTasks = jest.fn().mockImplementationOnce(noConnection).mockResolvedValue([water, train])
    const { user } = await start({ keptBoard: memoryBoard(kept), fetchTasks })

    await screen.findByText(OFFLINE)
    await user.press(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Book the train')).toBeOnTheScreen()
    expect(screen.queryByText(OFFLINE)).toBeNull()
  })

  it('keeps the board shown when loading it again in the foreground fails', async () => {
    let onChange: (state: string) => void = () => undefined
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      onChange = listener as (state: string) => void
      return { remove: jest.fn() } as never
    })
    const fetchTasks = jest.fn().mockResolvedValueOnce([water, train]).mockImplementation(noConnection)
    await start({ fetchTasks })
    await screen.findByText('Book the train')

    await act(async () => onChange('active'))

    expect(await screen.findByText(OFFLINE)).toBeOnTheScreen()
    expect(screen.getByText('Book the train')).toBeOnTheScreen()
  })

  it('never shows another account’s kept board', async () => {
    const someoneElse = { account: 'bob@example.com', savedAt: NOW - HOUR, tasks: [train] }
    await start({ keptBoard: memoryBoard(someoneElse), fetchTasks: jest.fn(noConnection) })

    expect(await screen.findByText('Unexpected error while loading data.')).toBeOnTheScreen()
    expect(screen.queryByText('Book the train')).toBeNull()
  })

  it('refuses every change while the board may not be current, rather than queueing it', async () => {
    const { deps, user } = await start({ keptBoard: memoryBoard(kept), fetchTasks: jest.fn(noConnection) })
    await screen.findByText(OFFLINE)
    const refused = 'Nothing can be changed without a connection. Try again once you are online.'

    await user.press(screen.getByRole('checkbox', { name: 'Mark "Water the plants" as done' }))
    expect(screen.getByText(refused)).toBeOnTheScreen()
    expect(screen.getByRole('checkbox', { name: 'Mark "Water the plants" as done', checked: false })).toBeOnTheScreen()

    await user.press(screen.getByRole('button', { name: 'Edit "Water the plants"' }))
    await user.press(screen.getByRole('button', { name: 'Add a task' }))

    expect(screen.queryByLabelText('What needs doing')).toBeNull()
    expect(screen.queryByLabelText('Description')).toBeNull()
    expect(deps.changes.update).not.toHaveBeenCalled()
  })

  it('refuses changes while the kept board waits for the network, too', async () => {
    const { deps, user } = await start({ keptBoard: memoryBoard(kept), fetchTasks: jest.fn(pending) })
    await screen.findByText('Water the plants')

    await user.press(screen.getByRole('checkbox', { name: 'Mark "Water the plants" as done' }))

    expect(screen.getByText('Just a moment: your tasks are being loaded.')).toBeOnTheScreen()
    expect(deps.changes.update).not.toHaveBeenCalled()
  })

  it('keeps a change once the backend has it', async () => {
    const keptBoard = memoryBoard(null)
    const { user } = await start({ keptBoard })
    await screen.findByText('Book the train')

    await user.press(screen.getByRole('checkbox', { name: 'Mark "Water the plants" as done' }))

    await screen.findByText('Completed (1)')
    expect(keptBoard.current()?.tasks).toEqual([{ ...water, state: 'DONE' }, train])
  })

  it('forgets the kept board on signing out', async () => {
    const keptBoard = memoryBoard(kept)
    const { user } = await start({ keptBoard })
    await screen.findByText('Book the train')

    await user.press(screen.getByRole('button', { name: 'Account' }))
    await user.press(screen.getByRole('button', { name: 'Sign out' }))

    await screen.findByRole('button', { name: 'Sign in with Keycloak' })
    expect(keptBoard.current()).toBeNull()
  })

  it('forgets the kept board with the account', async () => {
    const keptBoard = memoryBoard(kept)
    const { user } = await start({ keptBoard })
    await screen.findByText('Book the train')

    await user.press(screen.getByRole('button', { name: 'Account' }))
    await user.press(screen.getByRole('button', { name: 'Delete account' }))
    await user.type(screen.getByLabelText('Type your email address to confirm'), 'ada@example.com')
    await user.press(screen.getByRole('button', { name: 'Delete my account' }))

    await screen.findByText('Your account has been deleted. Signing in again starts a new, empty one.')
    expect(keptBoard.current()).toBeNull()
  })

  it('carries on without a board kept when the phone cannot keep one', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const broken: KeptBoardStore = {
      load: jest.fn().mockRejectedValue(new Error('disk')),
      save: jest.fn().mockRejectedValue(new Error('disk full')),
      clear: jest.fn().mockRejectedValue(new Error('disk')),
    }
    const { user } = await start({ keptBoard: broken })

    expect(await screen.findByText('Book the train')).toBeOnTheScreen()
    await user.press(screen.getByRole('button', { name: 'Account' }))
    await user.press(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('button', { name: 'Sign in with Keycloak' })).toBeOnTheScreen()
    expect(console.warn).toHaveBeenCalledWith('The board could not be kept', expect.any(Error))
    expect(console.warn).toHaveBeenCalledWith('The kept board could not be forgotten', expect.any(Error))
  })

  it('forgets the kept board when the backend no longer accepts the session', async () => {
    const keptBoard = memoryBoard(kept)
    await start({ keptBoard, fetchTasks: jest.fn().mockRejectedValue(new SignedOutError()) })

    await screen.findByText('Your session has expired. Sign in again to carry on.')
    expect(keptBoard.current()).toBeNull()
  })
})
