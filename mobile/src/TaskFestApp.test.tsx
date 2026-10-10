import { render, screen, userEvent } from '@testing-library/react-native'
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

    expect(await screen.findByText('Nothing here yet. Add your first task.')).toBeOnTheScreen()
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

  it('speaks German to a German phone', async () => {
    await render(
      <TaskFestApp variant={variants.dev} language="de" dependencies={dependencies({ sessions: memorySessions(session) })} />,
    )

    expect(await screen.findByText('Heute')).toBeOnTheScreen()
  })
})
