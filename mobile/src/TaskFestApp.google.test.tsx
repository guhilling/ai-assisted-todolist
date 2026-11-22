import { render, screen, userEvent } from '@testing-library/react-native'
import type { Session } from './session'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import { HOUR, dependencies as appDependencies, memorySessions, prod, qa, tokenWith } from './testing'
import type { Task } from './web'

// Its own day, with a task due on it, rather than the shared NOW and board.
const NOW = Date.UTC(2026, 9, 17, 9)
const tasks: Task[] = [{ id: 1, description: 'Water the plants', dueDate: '2026-10-17', importance: 'HIGH', state: 'TODO' }]

function googleProvider() {
  return { signIn: jest.fn(), signOut: jest.fn().mockResolvedValue(undefined) }
}

/** Nobody signed in, and Google's sign-in to hand. */
function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return appDependencies({
    sessions: memorySessions(null),
    google: googleProvider(),
    fetchTasks: jest.fn().mockResolvedValue(tasks),
    now: () => NOW,
    ...overrides,
  })
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
    const provider = { signIn: jest.fn() }
    await render(<TaskFestApp variant={prod} language="en" dependencies={dependencies({ sessions, fetchTasks, google, provider })} />)

    await userEvent.setup().press(await screen.findByRole('button', { name: 'Sign in with Google' }))

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
    expect(sessions.current()).toMatchObject({ token: idToken, via: 'google' })
    expect(fetchTasks).toHaveBeenCalledWith({ baseUrl: 'https://taskfest.cloud.hilling.de', token: idToken })
    expect(provider.signIn).not.toHaveBeenCalled()
  })

  it('signs out of Google too, so the next sign-in asks which account', async () => {
    const session: Session = { token: 'id', expiresAt: NOW + HOUR, via: 'google', email: null }
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
    const session: Session = { token: 'id', expiresAt: NOW + HOUR, via: 'google', email: null }
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
    const session: Session = { token: 'id', expiresAt: NOW + HOUR, email: null }
    const google = googleProvider()
    await render(<TaskFestApp variant={qa} language="en" dependencies={dependencies({ sessions: memorySessions(session), google })} />)
    await screen.findByText('Water the plants')
    const user = userEvent.setup()

    await user.press(screen.getByRole('button', { name: 'Account' }))
    await user.press(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeOnTheScreen()
    expect(google.signOut).not.toHaveBeenCalled()
  })

})
