import { act, fireEvent, render, screen, userEvent, waitFor } from '@testing-library/react-native'
import { RequestFailedError, SignedOutError, TimedOutError } from './api'
import type { AppleProvider } from './apple'
import type { KeptBoard } from './keptBoard'
import type { Session } from './session'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import { HOUR, dependencies as appDependencies, foreground, memoryBoard, memorySessions, prod, qa, tokenWith } from './testing'
import type { Variant } from './variants'
import type { Task } from './web'

// Its own day, with a task due on it, rather than the shared NOW and board.
const NOW = Date.UTC(2026, 10, 17, 9)
const DAY = 24 * HOUR
const PROD = 'https://taskfest.cloud.hilling.de'
const tasks: Task[] = [{ id: 1, description: 'Water the plants', dueDate: '2026-11-17', importance: 'HIGH', state: 'TODO' }]

/** Ada's ID token, as any provider issues it: good for an hour. */
const idToken = tokenWith({ exp: (NOW + HOUR) / 1000, email: 'ada@example.com' })
/** The app session the backend trades it for. */
const appSession: Session = {
  token: 'taskfest_app_ada',
  expiresAt: NOW + 30 * DAY,
  email: 'ada@example.com',
}
const withApple: Variant = { ...prod, apple: true }

function appSessions() {
  return {
    start: jest.fn().mockResolvedValue({ token: 'taskfest_app_ada', expiresAt: NOW + 30 * DAY }),
    end: jest.fn().mockResolvedValue(undefined),
  }
}

function googleProvider() {
  return { signIn: jest.fn().mockResolvedValue({ idToken }), signOut: jest.fn().mockResolvedValue(undefined) }
}

function apple(available = true): AppleProvider & { signIn: jest.Mock; confirm: jest.Mock } {
  return {
    available: jest.fn().mockResolvedValue(available),
    signIn: jest.fn().mockResolvedValue({ idToken }),
    confirm: jest.fn().mockResolvedValue('code-1'),
  }
}

/** Nobody signed in, Google to hand, and a backend that trades every ID token. */
function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return appDependencies({
    sessions: memorySessions(null),
    google: googleProvider(),
    appSessions: appSessions(),
    fetchTasks: jest.fn().mockResolvedValue(tasks),
    now: () => NOW,
    ...overrides,
  })
}

/** Presses Apple's button: a native view, which calls back by an event of its own, not `onPress`. */
async function pressApple(button: Parameters<typeof fireEvent>[0]) {
  await act(async () => fireEvent(button, 'buttonPress'))
}

async function signOutOfTheBoard() {
  const user = userEvent.setup()
  await user.press(screen.getByRole('button', { name: 'Account' }))
  await user.press(screen.getByRole('button', { name: 'Sign out' }))
}

describe('app sessions, in the app (#281)', () => {
  it('trades Google’s ID token for an app session at sign-in, and sends that from then on', async () => {
    const deps = dependencies()
    await render(<TaskFestApp variant={prod} language="en" dependencies={deps} />)

    await userEvent.setup().press(await screen.findByRole('button', { name: 'Sign in with Google' }))

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
    expect(deps.appSessions.start).toHaveBeenCalledWith(idToken)
    expect(deps.fetchTasks).toHaveBeenCalledWith({ baseUrl: PROD, token: 'taskfest_app_ada' })
    expect((deps.sessions as ReturnType<typeof memorySessions>).current()).toEqual({ ...appSession, via: 'google' })
  })

  it('trades the variant’s own provider’s ID token too', async () => {
    const provider = { signIn: jest.fn().mockResolvedValue({ idToken }) }
    const deps = dependencies({ provider })
    await render(<TaskFestApp variant={qa} language="en" dependencies={deps} />)

    await userEvent.setup().press(await screen.findByRole('button', { name: 'Sign in with TaskFest test account' }))

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
    expect((deps.sessions as ReturnType<typeof memorySessions>).current()).toEqual(appSession)
  })

  it('says signing in did not work when the backend refuses the trade, and keeps nothing', async () => {
    const trade = appSessions()
    trade.start.mockRejectedValue(new SignedOutError())
    const sessions = memorySessions(null)
    await render(<TaskFestApp variant={prod} language="en" dependencies={dependencies({ appSessions: trade, sessions })} />)

    await userEvent.setup().press(await screen.findByRole('button', { name: 'Sign in with Google' }))

    expect(await screen.findByText('Signing in did not work. Try again.')).toBeOnTheScreen()
    expect(sessions.current()).toBeNull()
  })

  it.each([
    ['there is no connection', new TypeError('Network request failed')],
    ['the trade goes unanswered', new TimedOutError(10_000)],
  ])('says signing in did not work when %s, keeps nothing, and lets it be tried again', async (_reason, failure) => {
    const trade = appSessions()
    trade.start.mockRejectedValueOnce(failure)
    const sessions = memorySessions(null)
    const fetchTasks = jest.fn().mockResolvedValue(tasks)
    const google = googleProvider()
    await render(<TaskFestApp variant={prod} language="en" dependencies={dependencies({ appSessions: trade, sessions, fetchTasks, google })} />)
    const user = userEvent.setup()

    await user.press(await screen.findByRole('button', { name: 'Sign in with Google' }))

    expect(await screen.findByText('Signing in did not work. Try again.')).toBeOnTheScreen()
    expect(sessions.current()).toBeNull()
    expect(google.signOut).toHaveBeenCalled()
    expect(fetchTasks).not.toHaveBeenCalled()

    await user.press(screen.getByRole('button', { name: 'Sign in with Google' }))

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
    expect(sessions.current()).toEqual({ ...appSession, via: 'google' })
  })

  it('shows the kept board of an app session’s account at once', async () => {
    const kept: KeptBoard = { account: 'ada@example.com', savedAt: NOW - HOUR, tasks }
    const fetchTasks = jest.fn(() => new Promise<Task[]>(() => undefined))
    await render(
      <TaskFestApp
        variant={prod}
        language="en"
        dependencies={dependencies({ sessions: memorySessions(appSession), keptBoard: memoryBoard(kept), fetchTasks })}
      />,
    )

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
  })

  it('ends the app session at the backend on signing out', async () => {
    const deps = dependencies({ sessions: memorySessions(appSession) })
    await render(<TaskFestApp variant={prod} language="en" dependencies={deps} />)
    await screen.findByText('Water the plants')

    await signOutOfTheBoard()

    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeOnTheScreen()
    expect(deps.appSessions.end).toHaveBeenCalledWith('taskfest_app_ada')
  })

  it('signs out of the phone even when the backend cannot be told', async () => {
    const trade = appSessions()
    trade.end.mockReturnValue(new Promise(() => undefined))
    const sessions = memorySessions(appSession)
    await render(<TaskFestApp variant={prod} language="en" dependencies={dependencies({ sessions, appSessions: trade })} />)
    await screen.findByText('Water the plants')

    await signOutOfTheBoard()

    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeOnTheScreen()
    expect(sessions.current()).toBeNull()
  })

  it('does not tell the backend of an app session it has refused already', async () => {
    const deps = dependencies({ sessions: memorySessions(appSession), fetchTasks: jest.fn().mockRejectedValue(new SignedOutError()) })
    await render(<TaskFestApp variant={prod} language="en" dependencies={deps} />)

    expect(await screen.findByText('Your session has expired. Sign in again to carry on.')).toBeOnTheScreen()
    expect(deps.appSessions.end).not.toHaveBeenCalled()
  })

  it('does not let a start forgetting the board of a session that ran out forget the board of a sign-in meanwhile', async () => {
    const back = foreground()
    const stored = memoryBoard(null)
    let forget: () => void = () => undefined
    let hold = false
    const keptBoard = {
      ...stored,
      // The return to the foreground's start forgets the board only when told.
      clear: jest.fn(() => {
        if (!hold) {
          return stored.clear()
        }
        hold = false
        return new Promise<void>((resolve) => (forget = () => void stored.clear().then(resolve)))
      }),
    }
    await render(<TaskFestApp variant={prod} language="en" dependencies={dependencies({ keptBoard })} />)
    const button = await screen.findByRole('button', { name: 'Sign in with Google' })
    hold = true
    await back()
    await waitFor(() => expect(keptBoard.clear).toHaveBeenCalledTimes(2))

    await userEvent.setup().press(button)
    await act(async () => forget())

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
    await waitFor(() => expect(stored.current()).toMatchObject({ account: 'ada@example.com' }))
  })

  it('does not let a lookup begun before a sign-in forget the session it saves', async () => {
    const back = foreground()
    const stored = memorySessions(null)
    let answer: (session: Session | null) => void = () => undefined
    let hang = false
    const sessions = {
      ...stored,
      // The start's lookups find nothing; the next one, the return to the foreground's, hangs until told.
      load: jest.fn(() => {
        if (!hang) {
          return stored.load()
        }
        hang = false
        return new Promise<Session | null>((resolve) => (answer = resolve))
      }),
    }
    await render(<TaskFestApp variant={prod} language="en" dependencies={dependencies({ sessions })} />)
    const button = await screen.findByRole('button', { name: 'Sign in with Google' })
    hang = true
    await back()

    await userEvent.setup().press(button)
    await act(async () => answer(null))

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
    expect(stored.current()).toEqual({ ...appSession, via: 'google' })
  })
})

describe('Sign in with Apple, in the app (#281)', () => {
  it('offers Apple beside Google where the build has it and the phone can, with what Hide My Email means', async () => {
    await render(<TaskFestApp variant={withApple} language="en" dependencies={dependencies({ apple: apple() })} />)

    expect(await screen.findByTestId('apple-sign-in')).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeOnTheScreen()
    expect(screen.getByText(/If you choose Hide My Email/)).toBeOnTheScreen()
  })

  it('does not offer Apple where the phone cannot sign in with it', async () => {
    const native = apple(false)
    await render(<TaskFestApp variant={withApple} language="en" dependencies={dependencies({ apple: native })} />)

    await screen.findByRole('button', { name: 'Sign in with Google' })
    await waitFor(() => expect(native.available).toHaveBeenCalled())
    expect(screen.queryByTestId('apple-sign-in')).toBeNull()
  })

  it('does not offer Apple where the platform has none: no provider, as on Android', async () => {
    await render(<TaskFestApp variant={withApple} language="en" dependencies={dependencies()} />)

    await screen.findByRole('button', { name: 'Sign in with Google' })
    expect(screen.queryByTestId('apple-sign-in')).toBeNull()
    expect(screen.queryByText(/If you choose Hide My Email/)).toBeNull()
  })

  it('signs in with Apple, trades its ID token, and shows the board', async () => {
    const native = apple()
    const google = googleProvider()
    const deps = dependencies({ apple: native, google })
    await render(<TaskFestApp variant={withApple} language="en" dependencies={deps} />)

    await pressApple(await screen.findByTestId('apple-sign-in'))

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
    expect(native.signIn).toHaveBeenCalled()
    expect(google.signIn).not.toHaveBeenCalled()
    expect(deps.appSessions.start).toHaveBeenCalledWith(idToken)
    expect((deps.sessions as ReturnType<typeof memorySessions>).current()).toEqual(appSession)
  })

  it('fails an Apple sign-in whose trade cannot be made, and lets it be tried again at once', async () => {
    const trade = appSessions()
    trade.start.mockRejectedValueOnce(new TypeError('Network request failed'))
    const sessions = memorySessions(null)
    await render(<TaskFestApp variant={withApple} language="en" dependencies={dependencies({ apple: apple(), appSessions: trade, sessions })} />)

    await pressApple(await screen.findByTestId('apple-sign-in'))

    expect(await screen.findByText('Signing in did not work. Try again.')).toBeOnTheScreen()
    expect(sessions.current()).toBeNull()

    await pressApple(screen.getByTestId('apple-sign-in'))

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
    expect(sessions.current()).toEqual(appSession)
  })

  it('stays at the sign-in, saying nothing, when the person turns Apple’s sheet away', async () => {
    const native = apple()
    native.signIn.mockResolvedValue(null)
    await render(<TaskFestApp variant={withApple} language="en" dependencies={dependencies({ apple: native })} />)

    await pressApple(await screen.findByTestId('apple-sign-in'))

    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeOnTheScreen()
    expect(screen.queryByText('Signing in did not work. Try again.')).toBeNull()
  })
})

/** Deletes the account from the board, as the account sheet asks it to be confirmed. */
async function deleteTheAccount() {
  const user = userEvent.setup()
  await user.press(screen.getByRole('button', { name: 'Account' }))
  await user.press(screen.getByRole('button', { name: 'Delete account' }))
  await user.type(screen.getByLabelText('Type your email address to confirm'), 'ada@example.com')
  await user.press(screen.getByRole('button', { name: 'Delete my account' }))
}

describe('deleting an account signed in with Apple (#635)', () => {
  /** A backend that deletes an Apple account only with Apple's confirmation. */
  function deleting() {
    return jest.fn((_caller: unknown, code?: string) => (code ? Promise.resolve() : Promise.reject(new RequestFailedError(428))))
  }

  it('asks Apple to confirm when the backend says it must, and deletes with the code Apple issues', async () => {
    const native = apple()
    const deleteAccount = deleting()
    const sessions = memorySessions(appSession)
    await render(<TaskFestApp variant={withApple} language="en" dependencies={dependencies({ apple: native, deleteAccount, sessions })} />)
    await screen.findByText('Water the plants')

    await deleteTheAccount()

    expect(await screen.findByText('Your account has been deleted. Signing in again starts a new, empty one.')).toBeOnTheScreen()
    expect(native.confirm).toHaveBeenCalledTimes(1)
    expect(deleteAccount.mock.calls).toEqual([
      [{ baseUrl: PROD, token: 'taskfest_app_ada' }],
      [{ baseUrl: PROD, token: 'taskfest_app_ada' }, 'code-1'],
    ])
    expect(sessions.current()).toBeNull()
  })

  it('keeps the account, signed in, when the person turns Apple’s sheet away', async () => {
    const native = apple()
    native.confirm.mockResolvedValue(null)
    const deleteAccount = deleting()
    const sessions = memorySessions(appSession)
    await render(<TaskFestApp variant={withApple} language="en" dependencies={dependencies({ apple: native, deleteAccount, sessions })} />)
    await screen.findByText('Water the plants')

    await deleteTheAccount()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete account' })).toBeOnTheScreen())
    expect(deleteAccount).toHaveBeenCalledTimes(1)
    expect(sessions.current()).toEqual(appSession)
    expect(screen.queryByText('Your account has been deleted. Signing in again starts a new, empty one.')).toBeNull()
  })

  it('asks nothing of Apple for an account the backend deletes as it is', async () => {
    const native = apple()
    const deleteAccount = jest.fn().mockResolvedValue(undefined)
    await render(
      <TaskFestApp variant={withApple} language="en" dependencies={dependencies({ apple: native, deleteAccount, sessions: memorySessions(appSession) })} />,
    )
    await screen.findByText('Water the plants')

    await deleteTheAccount()

    expect(await screen.findByText('Your account has been deleted. Signing in again starts a new, empty one.')).toBeOnTheScreen()
    expect(native.confirm).not.toHaveBeenCalled()
  })
})
