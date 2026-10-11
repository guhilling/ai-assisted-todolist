import { act, render, screen, userEvent } from '@testing-library/react-native'
import { AppState } from 'react-native'
import { SignedOutError } from './api'
import type { Session } from './session'
import type { SessionStore } from './staySignedIn'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import { variants } from './variants'
import type { Task } from './web'

const NOW = Date.UTC(2026, 9, 10, 9)
const TODAY = '2026-10-10'
const HOUR = 3600 * 1000

function tokenWith(payload: object) {
  return `h.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.s`
}

const session: Session = { idToken: 'stored', refreshToken: 'r', expiresAt: NOW + HOUR, lastUsedAt: NOW }

const tasks: Task[] = [
  { id: 1, description: 'Water the plants', dueDate: TODAY, importance: 'HIGH', state: 'TODO' },
  { id: 2, description: 'Book the train', dueDate: '2026-10-11', importance: 'LOW', state: 'WORKING' },
  { id: 3, description: 'Pay the rent', dueDate: '2026-10-01', importance: 'MEDIUM', state: 'DONE' },
]

function memorySessions(initial: Session | null): SessionStore & { current: () => Session | null } {
  let stored = initial
  return {
    current: () => stored,
    save: async (next) => void (stored = next),
    load: async () => stored,
    clear: async () => void (stored = null),
  }
}

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    sessions: memorySessions(null),
    provider: { signIn: jest.fn(), refresh: jest.fn() },
    fetchTasks: jest.fn().mockResolvedValue(tasks),
    fetchMinimumAppVersion: jest.fn().mockResolvedValue('0.0.0'),
    changes: { create: jest.fn(), update: jest.fn(), remove: jest.fn(), restore: jest.fn() },
    deleteAccount: jest.fn(),
    keptBoard: { load: jest.fn().mockResolvedValue(null), save: jest.fn().mockResolvedValue(undefined), clear: jest.fn().mockResolvedValue(undefined) },
    reminders: { permission: jest.fn().mockResolvedValue('denied'), ask: jest.fn(), replace: jest.fn().mockResolvedValue(undefined), answered: jest.fn().mockResolvedValue(false), decline: jest.fn() },
    appVersion: '1.2.0',
    now: () => NOW,
    ...overrides,
  }
}

describe('the app', () => {
  it('offers the variant’s sign-in to someone not signed in', async () => {
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={dependencies()} />)

    expect(await screen.findByRole('button', { name: 'Sign in with Keycloak' })).toBeOnTheScreen()
  })

  it('says so where the variant has no sign-in yet', async () => {
    await render(<TaskFestApp variant={variants.prod} language="en" dependencies={dependencies()} />)

    expect(await screen.findByText('Sign-in is not configured for this deployment.')).toBeOnTheScreen()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('signs in through the provider, keeps the session and shows the board', async () => {
    const idToken = tokenWith({ exp: (NOW + HOUR) / 1000 })
    const sessions = memorySessions(null)
    const fetchTasks = jest.fn().mockResolvedValue(tasks)
    const deps = dependencies({
      sessions,
      fetchTasks,
      provider: { signIn: jest.fn().mockResolvedValue({ idToken, refreshToken: 'r' }), refresh: jest.fn() },
    })
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={deps} />)

    await userEvent.setup().press(await screen.findByRole('button', { name: 'Sign in with Keycloak' }))

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
    expect(sessions.current()?.idToken).toBe(idToken)
    expect(fetchTasks).toHaveBeenCalledWith({ baseUrl: 'http://localhost:3000', idToken })
  })

  it('says so when signing in fails, and offers it again', async () => {
    const deps = dependencies({ provider: { signIn: jest.fn().mockRejectedValue(new Error('no token')), refresh: jest.fn() } })
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={deps} />)

    await userEvent.setup().press(await screen.findByRole('button', { name: 'Sign in with Keycloak' }))

    expect(await screen.findByText('Signing in did not work. Try again.')).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Sign in with Keycloak' })).toBeOnTheScreen()
  })

  it('says so when the provider’s answer holds no ID token it can use', async () => {
    const deps = dependencies({ provider: { signIn: jest.fn().mockResolvedValue({ refreshToken: 'r' }), refresh: jest.fn() } })
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={deps} />)

    await userEvent.setup().press(await screen.findByRole('button', { name: 'Sign in with Keycloak' }))

    expect(await screen.findByText('Signing in did not work. Try again.')).toBeOnTheScreen()
    expect(deps.fetchTasks).not.toHaveBeenCalled()
  })

  it('offers the sign-in when the kept session cannot be read', async () => {
    const broken = memorySessions(null)
    broken.load = jest.fn().mockRejectedValue(new Error('keystore invalidated'))
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={dependencies({ sessions: broken })} />)

    expect(await screen.findByRole('button', { name: 'Sign in with Keycloak' })).toBeOnTheScreen()
  })

  it('keeps the session and offers to try again when it cannot be renewed for now', async () => {
    const expiring = { ...session, expiresAt: NOW }
    const sessions = memorySessions(expiring)
    const refresh = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce({ idToken: tokenWith({ exp: (NOW + HOUR) / 1000 }) })
    const deps = dependencies({ sessions, provider: { signIn: jest.fn(), refresh } })
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={deps} />)

    await userEvent.setup().press(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
    expect(sessions.current()).not.toBeNull()
  })

  it('offers to try again when the board cannot be loaded', async () => {
    const fetchTasks = jest.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce(tasks)
    const deps = dependencies({ sessions: memorySessions(session), fetchTasks })
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={deps} />)

    expect(await screen.findByText('Unexpected error while loading data.')).toBeOnTheScreen()
    await userEvent.setup().press(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
  })

  it('stays on the sign-in when the user turns back', async () => {
    const deps = dependencies({ provider: { signIn: jest.fn().mockResolvedValue(null), refresh: jest.fn() } })
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={deps} />)

    await userEvent.setup().press(await screen.findByRole('button', { name: 'Sign in with Keycloak' }))

    expect(await screen.findByRole('button', { name: 'Sign in with Keycloak' })).toBeOnTheScreen()
    expect(deps.fetchTasks).not.toHaveBeenCalled()
  })

  it('opens on the board with a kept session, in the website’s sections', async () => {
    await render(
      <TaskFestApp variant={variants.dev} language="en" dependencies={dependencies({ sessions: memorySessions(session) })} />,
    )

    expect(await screen.findByText('Today')).toBeOnTheScreen()
    expect(screen.getByText('Water the plants')).toBeOnTheScreen()
    expect(screen.getByText('Tomorrow')).toBeOnTheScreen()
    expect(screen.getByText('Book the train')).toBeOnTheScreen()
    expect(screen.getByText('Completed (1)')).toBeOnTheScreen()
    expect(screen.getByText('Pay the rent')).toBeOnTheScreen()
  })

  it('says so when there is nothing on the board', async () => {
    const deps = dependencies({ sessions: memorySessions(session), fetchTasks: jest.fn().mockResolvedValue([]) })
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={deps} />)

    // Not the website's "Add your first task": the app's add button sits below the board instead.
    expect(await screen.findByText('Nothing here yet.')).toBeOnTheScreen()
  })

  it('asks for a sign-in again when the backend no longer accepts the session', async () => {
    const sessions = memorySessions(session)
    const deps = dependencies({ sessions, fetchTasks: jest.fn().mockRejectedValue(new SignedOutError()) })
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={deps} />)

    expect(await screen.findByText('Your session has expired. Sign in again to carry on.')).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Sign in with Keycloak' })).toBeOnTheScreen()
    expect(sessions.current()).toBeNull()
  })

  it('says so when the board cannot be loaded', async () => {
    const deps = dependencies({ sessions: memorySessions(session), fetchTasks: jest.fn().mockRejectedValue(new Error('down')) })
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={deps} />)

    expect(await screen.findByText('Unexpected error while loading data.')).toBeOnTheScreen()
  })

  it('asks for an update when the backend no longer serves this release (#268)', async () => {
    const deps = dependencies({ sessions: memorySessions(session), fetchMinimumAppVersion: jest.fn().mockResolvedValue('1.3.0') })
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={deps} />)

    expect(
      await screen.findByText('This version of the app is too old for TaskFest. Update it to carry on.'),
    ).toBeOnTheScreen()
    expect(deps.fetchTasks).not.toHaveBeenCalled()
  })

  it('lets the user try again once told to update', async () => {
    const fetchMinimumAppVersion = jest.fn().mockResolvedValueOnce('1.3.0').mockResolvedValueOnce('1.0.0')
    const deps = dependencies({ sessions: memorySessions(session), fetchMinimumAppVersion })
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={deps} />)

    await userEvent.setup().press(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
  })

  it('checks again when it comes back to the foreground', async () => {
    let onChange: (state: string) => void = () => undefined
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      onChange = listener as (state: string) => void
      return { remove: jest.fn() } as never
    })
    const fetchMinimumAppVersion = jest.fn().mockResolvedValueOnce('0.0.0').mockResolvedValueOnce('1.3.0')
    const deps = dependencies({ sessions: memorySessions(session), fetchMinimumAppVersion })
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={deps} />)
    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()

    await act(async () => onChange('active'))

    expect(
      await screen.findByText('This version of the app is too old for TaskFest. Update it to carry on.'),
    ).toBeOnTheScreen()
  })

  it('does not wait long for the answer before showing the sign-in', async () => {
    jest.useFakeTimers()
    try {
      const deps = dependencies({ fetchMinimumAppVersion: () => new Promise<string>(() => undefined) })
      await render(<TaskFestApp variant={variants.dev} language="en" dependencies={deps} />)

      await act(async () => jest.advanceTimersByTime(5000))

      expect(screen.getByRole('button', { name: 'Sign in with Keycloak' })).toBeOnTheScreen()
    } finally {
      jest.useRealTimers()
    }
  })

  it('carries on when it cannot tell which releases the backend serves', async () => {
    const deps = dependencies({ fetchMinimumAppVersion: jest.fn().mockRejectedValue(new Error('offline')) })
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={deps} />)

    expect(await screen.findByRole('button', { name: 'Sign in with Keycloak' })).toBeOnTheScreen()
  })

  it('marks a value it does not know, rather than hiding the task', async () => {
    const newer = [{ ...tasks[0], unknown: ['importance' as const] }]
    const deps = dependencies({ sessions: memorySessions(session), fetchTasks: jest.fn().mockResolvedValue(newer) })
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={deps} />)

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
    expect(screen.getByLabelText('Unknown')).toBeOnTheScreen()
  })

  it('marks a state it does not know, too', async () => {
    const newer = [{ ...tasks[0], unknown: ['state' as const] }]
    const deps = dependencies({ sessions: memorySessions(session), fetchTasks: jest.fn().mockResolvedValue(newer) })
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={deps} />)

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
    expect(screen.getByText('Unknown')).toBeOnTheScreen()
  })

  it('speaks German to a German phone', async () => {
    await render(
      <TaskFestApp variant={variants.dev} language="de" dependencies={dependencies({ sessions: memorySessions(session) })} />,
    )

    expect(await screen.findByText('Heute')).toBeOnTheScreen()
  })
})
