import { act, render, screen, userEvent } from '@testing-library/react-native'
import { AppState } from 'react-native'
import type { Session } from './session'
import type { SessionStore } from './staySignedIn'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import { variantOf } from './variants'
import type { Task } from './web'

const NOW = Date.UTC(2026, 9, 17, 9)
const HOUR = 3600 * 1000

function tokenWith(payload: object) {
  return `h.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.s`
}

const tasks: Task[] = [{ id: 1, description: 'Water the plants', dueDate: '2026-10-17', importance: 'HIGH', state: 'TODO' }]

const GOOGLE = {
  TASKFEST_GOOGLE_WEB_CLIENT_ID: '1234-web.apps.googleusercontent.com',
  TASKFEST_QA_GOOGLE_IOS_CLIENT_ID: '1234-qa.apps.googleusercontent.com',
  TASKFEST_PROD_GOOGLE_IOS_CLIENT_ID: '1234-prod.apps.googleusercontent.com',
}
const prod = variantOf('prod', GOOGLE)
const qa = variantOf('qa', {
  ...GOOGLE,
  TASKFEST_QA_COGNITO_ISSUER: 'https://cognito-idp.eu-central-1.amazonaws.com/pool',
  TASKFEST_QA_APP_CLIENT_ID: 'app-client',
})

function memorySessions(initial: Session | null): SessionStore & { current: () => Session | null } {
  let stored = initial
  return {
    current: () => stored,
    save: async (next) => void (stored = next),
    load: async () => stored,
    clear: async () => void (stored = null),
  }
}

function googleProvider() {
  return { signIn: jest.fn(), renew: jest.fn(), signOut: jest.fn().mockResolvedValue(undefined) }
}

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    sessions: memorySessions(null),
    provider: { signIn: jest.fn(), refresh: jest.fn() },
    google: googleProvider(),
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

describe('signing in with Google, in the app (#280)', () => {
  it('offers Google on prod, where it is the only way in', async () => {
    await render(<TaskFestApp variant={prod} language="en" dependencies={dependencies()} />)

    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeOnTheScreen()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByText('Sign-in is not configured for this deployment.')).toBeNull()
  })

  it('offers Google and the test accounts on qa', async () => {
    await render(<TaskFestApp variant={qa} language="en" dependencies={dependencies()} />)

    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Sign in with TaskFest test account' })).toBeOnTheScreen()
  })

  it('signs in with Google, keeps a session that says so, and shows the board', async () => {
    const idToken = tokenWith({ exp: (NOW + HOUR) / 1000 })
    const sessions = memorySessions(null)
    const fetchTasks = jest.fn().mockResolvedValue(tasks)
    const google = googleProvider()
    google.signIn.mockResolvedValue({ idToken })
    const provider = { signIn: jest.fn(), refresh: jest.fn() }
    await render(<TaskFestApp variant={prod} language="en" dependencies={dependencies({ sessions, fetchTasks, google, provider })} />)

    await userEvent.setup().press(await screen.findByRole('button', { name: 'Sign in with Google' }))

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
    expect(sessions.current()).toMatchObject({ idToken, refreshToken: null, via: 'google' })
    expect(fetchTasks).toHaveBeenCalledWith({ baseUrl: 'https://taskfest.cloud.hilling.de', idToken })
    expect(provider.signIn).not.toHaveBeenCalled()
  })

  it('renews a Google session with Google when its ID token runs out', async () => {
    const stale: Session = { idToken: 'stale', refreshToken: null, expiresAt: NOW, lastUsedAt: NOW - HOUR, via: 'google' }
    const fresh = tokenWith({ exp: (NOW + HOUR) / 1000 })
    const google = googleProvider()
    google.renew.mockResolvedValue({ idToken: fresh })
    const fetchTasks = jest.fn().mockResolvedValue(tasks)
    await render(
      <TaskFestApp variant={prod} language="en" dependencies={dependencies({ sessions: memorySessions(stale), google, fetchTasks })} />,
    )

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
    expect(fetchTasks).toHaveBeenCalledWith({ baseUrl: 'https://taskfest.cloud.hilling.de', idToken: fresh })
  })

  it('signs out of Google too, so the next sign-in asks which account', async () => {
    const session: Session = { idToken: 'id', refreshToken: null, expiresAt: NOW + HOUR, lastUsedAt: NOW, via: 'google' }
    const google = googleProvider()
    const sessions = memorySessions(session)
    await render(<TaskFestApp variant={prod} language="en" dependencies={dependencies({ sessions, google })} />)
    await screen.findByText('Water the plants')
    const user = userEvent.setup()

    await user.press(screen.getByRole('button', { name: 'Account' }))
    await user.press(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeOnTheScreen()
    expect(google.signOut).toHaveBeenCalled()
    expect(sessions.current()).toBeNull()
  })

  it('signs out of the phone even when Google’s SDK never answers', async () => {
    const session: Session = { idToken: 'id', refreshToken: null, expiresAt: NOW + HOUR, lastUsedAt: NOW, via: 'google' }
    const google = googleProvider()
    google.signOut.mockReturnValue(new Promise(() => undefined))
    await render(<TaskFestApp variant={prod} language="en" dependencies={dependencies({ sessions: memorySessions(session), google })} />)
    await screen.findByText('Water the plants')
    const user = userEvent.setup()

    await user.press(screen.getByRole('button', { name: 'Account' }))
    await user.press(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeOnTheScreen()
  })

  it('leaves Google alone when the session was a test account’s', async () => {
    const session: Session = { idToken: 'id', refreshToken: 'r', expiresAt: NOW + HOUR, lastUsedAt: NOW }
    const google = googleProvider()
    await render(<TaskFestApp variant={qa} language="en" dependencies={dependencies({ sessions: memorySessions(session), google })} />)
    await screen.findByText('Water the plants')
    const user = userEvent.setup()

    await user.press(screen.getByRole('button', { name: 'Account' }))
    await user.press(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeOnTheScreen()
    expect(google.signOut).not.toHaveBeenCalled()
  })

  it('does not start over when Android’s account sheet, shown by a renewal, hands the app back', async () => {
    let onChange: (state: string) => void = () => undefined
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      onChange = listener as (state: string) => void
      return { remove: jest.fn() } as never
    })
    const stale: Session = { idToken: 'stale', refreshToken: null, expiresAt: NOW, lastUsedAt: NOW - HOUR, via: 'google' }
    const fresh = tokenWith({ exp: (NOW + HOUR) / 1000 })
    let answer: (tokens: { idToken: string }) => void = () => undefined
    const google = googleProvider()
    google.renew.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const fetchMinimumAppVersion = jest.fn().mockResolvedValue('0.0.0')
    await render(
      <TaskFestApp variant={prod} language="en" dependencies={dependencies({ sessions: memorySessions(stale), google, fetchMinimumAppVersion })} />,
    )

    await act(async () => onChange('active'))
    await act(async () => answer({ idToken: fresh }))

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
    expect(fetchMinimumAppVersion).toHaveBeenCalledTimes(1)
  })
})

