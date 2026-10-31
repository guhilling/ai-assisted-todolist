import { act, fireEvent, render, screen, userEvent, waitFor, within } from '@testing-library/react-native'
import { Linking } from 'react-native'
import { RequestFailedError, SignedOutError, type BoardTask } from './api'
import type { Session } from './session'
import type { Tokens } from './staySignedIn'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import {
  BASE,
  NOW,
  dependencies as appDependencies,
  foreground,
  idToken,
  linkTo,
  memoryBoard,
  memorySessions,
  session,
  tokenWith,
  train,
  water,
} from './testing'
import type { PickedFile } from './upload'
import { variants } from './variants'
import type { Language } from './web'

jest.mock('./DueDatePicker', () => ({ DueDatePicker: () => null }))

/** One task on the board. */
function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return appDependencies({ fetchTasks: jest.fn().mockResolvedValue([water]), ...overrides })
}

async function openAccount(overrides: Partial<Dependencies> = {}, language: Language = 'en') {
  const deps = dependencies(overrides)
  await render(<TaskFestApp variant={variants.dev} language={language} dependencies={deps} />)
  await screen.findByText('Water the plants')
  const user = userEvent.setup()
  await user.press(screen.getByRole('button', { name: language === 'en' ? 'Account' : 'Konto' }))
  return { deps, user }
}

// jest-expo's Linking is a mock already, which outlives each test's calls unless they are cleared.
beforeEach(() => {
  jest.spyOn(Linking, 'openURL').mockClear().mockResolvedValue(true)
})

describe('the account, from the app (#275)', () => {
  it('says who is signed in, and which release this is', async () => {
    await openAccount()

    expect(screen.getByText('Signed in as ada@example.com')).toBeOnTheScreen()
    expect(screen.getByText('Version 1.2.0')).toBeOnTheScreen()
  })

  it('calls a build from a branch a development build', async () => {
    await openAccount({ appVersion: '0.0.0' })

    expect(screen.getByText('Development build')).toBeOnTheScreen()
  })

  it('goes back to the board when done', async () => {
    const { user } = await openAccount()

    await user.press(screen.getByRole('button', { name: 'Done' }))

    expect(screen.queryByText('Signed in as ada@example.com')).toBeNull()
    expect(screen.getByText('Water the plants')).toBeOnTheScreen()
  })

  it('signs out on the phone, forgetting the session, and offers the sign-in again', async () => {
    const sessions = memorySessions(session)
    const { deps, user } = await openAccount({ sessions })

    await user.press(screen.getByRole('button', { name: 'Sign out' }))

    expect(sessions.current()).toBeNull()
    expect(await screen.findByRole('button', { name: 'Sign in with Keycloak' })).toBeOnTheScreen()
    expect(screen.queryByText('Water the plants')).toBeNull()
    expect(screen.queryByText('Your session has expired. Sign in again to carry on.')).toBeNull()
    expect(deps.deleteAccount).not.toHaveBeenCalled()
  })

  it('asks for the signed-in address before it deletes the account', async () => {
    const { deps, user } = await openAccount()

    await user.press(screen.getByRole('button', { name: 'Delete account' }))

    expect(screen.getByText('Delete your account?')).toBeOnTheScreen()
    expect(
      screen.getByText('Every task and every file you have here is deleted, for good. This cannot be undone.'),
    ).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeDisabled()
    await user.type(screen.getByLabelText('Type your email address to confirm'), 'ada@example.co')
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeDisabled()
    expect(deps.deleteAccount).not.toHaveBeenCalled()
  })

  it('takes the address in any case, with spaces around it', async () => {
    const { user } = await openAccount()

    await user.press(screen.getByRole('button', { name: 'Delete account' }))
    await user.type(screen.getByLabelText('Type your email address to confirm'), ' Ada@Example.com ')

    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeEnabled()
  })

  it('keeps the account when told to', async () => {
    const { deps, user } = await openAccount()

    await user.press(screen.getByRole('button', { name: 'Delete account' }))
    await user.press(screen.getByRole('button', { name: 'Keep my account' }))

    expect(screen.queryByText('Delete your account?')).toBeNull()
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeOnTheScreen()
    expect(deps.deleteAccount).not.toHaveBeenCalled()
  })

  it('deletes the account, then signs out and says so', async () => {
    const sessions = memorySessions(session)
    const { deps, user } = await openAccount({ sessions })

    await user.press(screen.getByRole('button', { name: 'Delete account' }))
    await user.type(screen.getByLabelText('Type your email address to confirm'), 'ada@example.com')
    await user.press(screen.getByRole('button', { name: 'Delete my account' }))

    expect(deps.deleteAccount).toHaveBeenCalledWith({ baseUrl: BASE, idToken })
    expect(
      await screen.findByText('Your account has been deleted. Signing in again starts a new, empty one.'),
    ).toBeOnTheScreen()
    expect(sessions.current()).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign in with Keycloak' })).toBeOnTheScreen()
  })

  it('cannot be deleted twice while the first delete is on its way', async () => {
    const { deps, user } = await openAccount({ deleteAccount: jest.fn(() => new Promise<void>(() => undefined)) })

    await user.press(screen.getByRole('button', { name: 'Delete account' }))
    await user.type(screen.getByLabelText('Type your email address to confirm'), 'ada@example.com')
    await user.press(screen.getByRole('button', { name: 'Delete my account' }))

    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled()
    expect(deps.deleteAccount).toHaveBeenCalledTimes(1)
  })

  it('stays signed in, and says so, when the backend refuses the delete', async () => {
    const sessions = memorySessions(session)
    const { user } = await openAccount({ sessions, deleteAccount: jest.fn().mockRejectedValue(new RequestFailedError(500)) })

    await user.press(screen.getByRole('button', { name: 'Delete account' }))
    await user.type(screen.getByLabelText('Type your email address to confirm'), 'ada@example.com')
    await user.press(screen.getByRole('button', { name: 'Delete my account' }))

    expect(await screen.findByText('Unable to delete your account.')).toBeOnTheScreen()
    expect(screen.queryByText('Delete your account?')).toBeNull()
    expect(sessions.current()).not.toBeNull()
  })

  it('asks for a sign-in again when the backend no longer accepts the session', async () => {
    const { user } = await openAccount({ deleteAccount: jest.fn().mockRejectedValue(new SignedOutError()) })

    await user.press(screen.getByRole('button', { name: 'Delete account' }))
    await user.type(screen.getByLabelText('Type your email address to confirm'), 'ada@example.com')
    await user.press(screen.getByRole('button', { name: 'Delete my account' }))

    expect(await screen.findByText('Your session has expired. Sign in again to carry on.')).toBeOnTheScreen()
  })

  it('cannot be deleted when the token names no address to type', async () => {
    const anonymous = { ...session, idToken: tokenWith({ exp: NOW / 1000 + 3600 }) }
    const { user } = await openAccount({ sessions: memorySessions(anonymous) })

    await user.press(screen.getByRole('button', { name: 'Delete account' }))
    await user.type(screen.getByLabelText('Type your email address to confirm'), 'ada@example.com')

    expect(screen.queryByText(/Signed in as/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeDisabled()
  })

  it('opens the imprint, the privacy policy and the terms in the browser', async () => {
    const { user } = await openAccount()

    await user.press(screen.getByRole('link', { name: 'Imprint' }))
    await user.press(screen.getByRole('link', { name: 'Privacy' }))
    await user.press(screen.getByRole('link', { name: 'Terms' }))

    expect(Linking.openURL).toHaveBeenNthCalledWith(1, 'https://www.hilling.it/impressum/')
    expect(Linking.openURL).toHaveBeenNthCalledWith(2, 'https://taskfest-docs.cloud.hilling.de/doc/privacy.html')
    expect(Linking.openURL).toHaveBeenNthCalledWith(3, 'https://taskfest-docs.cloud.hilling.de/doc/terms.html')
  })

  it('links the German pages in German', async () => {
    const { user } = await openAccount({}, 'de')

    await user.press(screen.getByRole('link', { name: 'Datenschutz' }))
    await user.press(screen.getByRole('link', { name: 'Nutzungsbedingungen' }))

    expect(screen.getByText('Angemeldet als ada@example.com')).toBeOnTheScreen()
    expect(Linking.openURL).toHaveBeenNthCalledWith(1, 'https://taskfest-docs.cloud.hilling.de/doc/datenschutz.html')
    expect(Linking.openURL).toHaveBeenNthCalledWith(2, 'https://taskfest-docs.cloud.hilling.de/doc/nutzungsbedingungen.html')
  })
})

async function confirmDelete(user: ReturnType<typeof userEvent.setup>) {
  await user.press(screen.getByRole('button', { name: 'Delete account' }))
  await user.type(screen.getByLabelText('Type your email address to confirm'), 'ada@example.com')
  await user.press(screen.getByRole('button', { name: 'Delete my account' }))
}

describe('the account, when things overlap (#275)', () => {
  it('stays signed out when a renewal under way finishes after the sign-out', async () => {
    const comeBack = foreground()
    const soon = tokenWith({ exp: (NOW + 30_000) / 1000, email: 'ada@example.com' })
    let renew: () => void = () => undefined
    const refresh = jest
      .fn()
      .mockResolvedValueOnce({ idToken: soon })
      .mockReturnValueOnce(new Promise((resolve) => (renew = () => resolve({ idToken }))))
    const sessions = memorySessions({ ...session, idToken: soon, expiresAt: NOW + 30_000 })
    const fetchTasks = jest.fn().mockResolvedValue([water])
    await render(
      <TaskFestApp
        variant={variants.dev}
        language="en"
        dependencies={dependencies({ sessions, fetchTasks, provider: { signIn: jest.fn(), refresh } })}
      />,
    )
    await screen.findByText('Water the plants')
    const user = userEvent.setup()

    await comeBack()
    await user.press(screen.getByRole('button', { name: 'Account' }))
    await user.press(screen.getByRole('button', { name: 'Sign out' }))
    await act(async () => renew())

    expect(sessions.current()).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign in with Keycloak' })).toBeOnTheScreen()
    expect(screen.queryByText('Water the plants')).toBeNull()
  })

  it('neither signs out nor closes while the delete is on its way', async () => {
    // A sign-out and a new sign-in before the answer would leave the late answer to sign out a
    // session that never asked for it (CodeRabbit on #291); nothing but waiting is offered instead.
    let refuse: () => void = () => undefined
    const deleteAccount = jest.fn(() => new Promise<void>((_resolve, reject) => (refuse = () => reject(new RequestFailedError(500)))))
    const { user } = await openAccount({ deleteAccount })

    await confirmDelete(user)
    await act(async () => fireEvent(screen.getByTestId('account-sheet'), 'requestClose'))

    expect(screen.getByRole('button', { name: 'Sign out' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled()
    expect(screen.getByText('Signed in as ada@example.com')).toBeOnTheScreen()

    await act(async () => refuse())

    expect(await screen.findByText('Unable to delete your account.')).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled()
  })

  it('signs out on the screen even when the keychain will not forget', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const sessions = { ...memorySessions(session), clear: jest.fn().mockRejectedValue(new Error('keychain')) }
    const { user } = await openAccount({ sessions })

    await user.press(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('button', { name: 'Sign in with Keycloak' })).toBeOnTheScreen()
    expect(console.warn).toHaveBeenCalled()
  })

  it('says the account was deleted even when the keychain will not forget', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const sessions = { ...memorySessions(session), clear: jest.fn().mockRejectedValue(new Error('keychain')) }
    const { user } = await openAccount({ sessions })

    await confirmDelete(user)

    expect(
      await screen.findByText('Your account has been deleted. Signing in again starts a new, empty one.'),
    ).toBeOnTheScreen()
  })

  it('does not start over in the foreground while the sheet is open', async () => {
    const comeBack = foreground()
    const fetchTasks = jest.fn().mockResolvedValue([water])
    const { user } = await openAccount({ fetchTasks })

    await user.press(screen.getByRole('button', { name: 'Delete account' }))
    await user.type(screen.getByLabelText('Type your email address to confirm'), 'ada@')
    await comeBack()

    expect(fetchTasks).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Type your email address to confirm')).toHaveDisplayValue('ada@')
  })

  it('still says the account was deleted after a trip to the background', async () => {
    const comeBack = foreground()
    const { user } = await openAccount()

    await confirmDelete(user)
    await screen.findByText('Your account has been deleted. Signing in again starts a new, empty one.')
    await comeBack()

    expect(screen.getByText('Your account has been deleted. Signing in again starts a new, empty one.')).toBeOnTheScreen()
  })

  it('does not start over when the sign-in comes back from the browser', async () => {
    // Coming back from the browser is a return to the foreground; starting over then would find no
    // session yet, and could forget the one the sign-in is about to save.
    const comeBack = foreground()
    let finish: () => void = () => undefined
    const signIn = jest.fn(() => new Promise<Tokens>((resolve) => (finish = () => resolve({ idToken, refreshToken: 'r' }))))
    const sessions = memorySessions(null)
    const fetchMinimumAppVersion = jest.fn().mockResolvedValue('0.0.0')
    await render(
      <TaskFestApp
        variant={variants.dev}
        language="en"
        dependencies={dependencies({ sessions, fetchMinimumAppVersion, provider: { signIn, refresh: jest.fn() } })}
      />,
    )
    const user = userEvent.setup()

    await user.press(await screen.findByRole('button', { name: 'Sign in with Keycloak' }))
    await comeBack()
    await act(async () => finish())

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
    expect(fetchMinimumAppVersion).toHaveBeenCalledTimes(1)
    expect(sessions.current()).not.toBeNull()
  })

  it('closes the sheet when the backend turns the session away on the next load', async () => {
    const comeBack = foreground()
    const signIn = jest.fn().mockResolvedValue({ idToken, refreshToken: 'r' })
    const fetchTasks = jest.fn().mockResolvedValueOnce([water]).mockRejectedValueOnce(new SignedOutError()).mockResolvedValue([water])
    const { user } = await openAccount({ fetchTasks, provider: { signIn, refresh: jest.fn() } })

    await user.press(screen.getByRole('button', { name: 'Done' }))
    await comeBack()
    await user.press(await screen.findByRole('button', { name: 'Sign in with Keycloak' }))

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
    expect(screen.queryByText('Signed in as ada@example.com')).toBeNull()
  })
})

/** A keychain whose next read, or next clear, waits until let go: a sign-out caught in the middle. */
function slowKeychain(initial: Session) {
  const kept = memorySessions(initial)
  let waiting: { step: 'load' | 'clear'; until: Promise<void> } | null = null
  let letGo: () => void = () => undefined
  const held = async (step: 'load' | 'clear') => {
    if (waiting?.step === step) {
      const { until } = waiting
      waiting = null
      await until
    }
  }
  return {
    ...kept,
    load: async () => {
      await held('load')
      return kept.load()
    },
    clear: async () => {
      await held('clear')
      return kept.clear()
    },
    hold: (step: 'load' | 'clear') => {
      waiting = { step, until: new Promise((resolve) => (letGo = resolve)) }
    },
    letGo: () => letGo(),
  }
}

describe('a renewal begun while the app signs out (#428)', () => {
  // The backend turns the first change away, which signs out; while the keychain is read or
  // cleared, a second change asks for a session, which renews: its renewal must not save it again.
  it.each(['load', 'clear'] as const)('stays signed out when it begins during the keychain’s %s', async (step) => {
    const soon = tokenWith({ exp: (NOW + 30_000) / 1000, email: 'ada@example.com' })
    let renew: () => void = () => undefined
    const refresh = jest
      .fn()
      .mockResolvedValueOnce({ idToken: soon })
      .mockResolvedValueOnce({ idToken: soon })
      .mockReturnValueOnce(new Promise((resolve) => (renew = () => resolve({ idToken }))))
    const sessions = slowKeychain({ ...session, idToken: soon, expiresAt: NOW + 30_000 })
    const update = jest
      .fn()
      .mockImplementationOnce(async () => {
        sessions.hold(step)
        throw new SignedOutError()
      })
      .mockImplementation(async (_caller, task: BoardTask) => task)
    await render(
      <TaskFestApp
        variant={variants.dev}
        language="en"
        dependencies={dependencies({
          sessions,
          fetchTasks: jest.fn().mockResolvedValue([water, train]),
          provider: { signIn: jest.fn(), refresh },
          changes: { create: jest.fn(), update, remove: jest.fn(), restore: jest.fn() },
        })}
      />,
    )
    const user = userEvent.setup()

    await user.press(await screen.findByRole('checkbox', { name: 'Mark "Water the plants" as done' }))
    await user.press(screen.getByRole('checkbox', { name: 'Mark "Book the train" as done' }))
    await act(async () => sessions.letGo())
    await act(async () => renew())

    expect(await screen.findByRole('button', { name: 'Sign in with Keycloak' })).toBeOnTheScreen()
    expect(sessions.current()).toBeNull()
  })
})

/** Bea, who signs in once Ada has signed out. */
const beasToken = tokenWith({ exp: NOW / 1000 + 3600, email: 'bea@example.com' })
/** Bea's one task, under the same id as Ada's: an answer for Ada's would land on it. */
const bank: BoardTask = { id: 1, description: 'Call the bank', dueDate: '2026-10-12', importance: 'LOW', state: 'TODO', attachments: [] }
const photo: PickedFile = { uri: 'file:///cache/photo.jpg', name: 'photo.jpg', type: 'image/jpeg', size: 2_000_000 }
const scan: PickedFile = { uri: 'file:///cache/scan.pdf', name: 'scan.pdf', type: 'application/pdf', size: 90_000 }
const attached = (file: PickedFile, id: number) => ({ id, fileName: file.name, contentType: file.type, sizeBytes: file.size, thumbnail: false })

/** A promise the test settles when it likes: a backend that answers late. */
function late<T>() {
  let answer: (value: T) => void = () => undefined
  let refuse: (cause: unknown) => void = () => undefined
  const promise = new Promise<T>((resolve, reject) => {
    answer = resolve
    refuse = reject
  })
  return { promise, answer, refuse }
}

/** Ada's board first and, once she has signed out and Bea in, Bea's -- each kept on the phone. */
function twoAccounts(overrides: Partial<Dependencies> = {}) {
  return dependencies({
    sessions: memorySessions(session),
    keptBoard: memoryBoard(null),
    fetchTasks: jest.fn().mockResolvedValueOnce([water]).mockResolvedValue([bank]),
    provider: { signIn: jest.fn().mockResolvedValue({ idToken: beasToken, refreshToken: 'b' }), refresh: jest.fn() },
    ...overrides,
  })
}

async function showAdas(deps: Dependencies) {
  await render(<TaskFestApp variant={variants.dev} language="en" dependencies={deps} />)
  await screen.findByText('Water the plants')
  return userEvent.setup()
}

/**
 * Ada signs out and Bea signs in; resolves once Bea's board is shown, with a check that it is still
 * hers alone -- on the screen, on the phone and in the reminders -- whatever arrives for Ada after.
 */
async function switchToBea(user: ReturnType<typeof userEvent.setup>, deps: Dependencies) {
  await user.press(screen.getByRole('button', { name: 'Account' }))
  await user.press(screen.getByRole('button', { name: 'Sign out' }))
  await user.press(await screen.findByRole('button', { name: 'Sign in with Keycloak' }))
  await screen.findByText('Call the bank')
  const kept = (deps.keptBoard.save as jest.Mock).mock.calls.length
  const reminded = (deps.reminders.replace as jest.Mock).mock.calls.length
  return () => {
    expect(screen.getByText('Call the bank')).toBeOnTheScreen()
    expect(screen.queryByText('Water the plants')).toBeNull()
    expect(screen.queryByText('Your session has expired. Sign in again to carry on.')).toBeNull()
    expect((deps.sessions as ReturnType<typeof memorySessions>).current()).toMatchObject({ idToken: beasToken })
    expect(deps.keptBoard.save).toHaveBeenCalledTimes(kept)
    expect(deps.reminders.replace).toHaveBeenCalledTimes(reminded)
  }
}

describe('an answer for the account signed out of (#428)', () => {
  it('adds no task to the next account’s board', async () => {
    const created = late<BoardTask>()
    const deps = twoAccounts({ changes: { create: jest.fn(() => created.promise), update: jest.fn(), remove: jest.fn(), restore: jest.fn() } })
    const user = await showAdas(deps)

    await user.press(screen.getByRole('button', { name: 'Add a task' }))
    await user.type(screen.getByLabelText('What needs doing'), 'Renew the passport')
    await user.press(screen.getByRole('button', { name: 'Add' }))
    await user.press(screen.getByRole('button', { name: 'Cancel' }))
    const stillBeas = await switchToBea(user, deps)
    await act(async () => created.answer({ id: 10, description: 'Renew the passport', dueDate: '2026-10-11', importance: 'MEDIUM', state: 'TODO' }))

    stillBeas()
    expect(screen.queryByText('Renew the passport')).toBeNull()
  })

  it('does not sign the next account out when it says the session had ended', async () => {
    const created = late<BoardTask>()
    const deps = twoAccounts({ changes: { create: jest.fn(() => created.promise), update: jest.fn(), remove: jest.fn(), restore: jest.fn() } })
    const user = await showAdas(deps)

    await user.press(screen.getByRole('button', { name: 'Add a task' }))
    await user.type(screen.getByLabelText('What needs doing'), 'Renew the passport')
    await user.press(screen.getByRole('button', { name: 'Add' }))
    await user.press(screen.getByRole('button', { name: 'Cancel' }))
    const stillBeas = await switchToBea(user, deps)
    await act(async () => created.refuse(new SignedOutError()))

    stillBeas()
  })

  it('puts no edit on the next account’s task of the same id', async () => {
    const saved = late<BoardTask>()
    const deps = twoAccounts({ changes: { create: jest.fn(), update: jest.fn(() => saved.promise), remove: jest.fn(), restore: jest.fn() } })
    const user = await showAdas(deps)

    await user.press(screen.getByRole('button', { name: 'Edit "Water the plants"' }))
    await user.press(screen.getByRole('button', { name: 'Save' }))
    await user.press(screen.getByRole('button', { name: 'Cancel' }))
    const stillBeas = await switchToBea(user, deps)
    await act(async () => saved.answer(water))

    stillBeas()
  })

  it('completes nothing on the next account’s board', async () => {
    const saved = late<BoardTask>()
    const deps = twoAccounts({ changes: { create: jest.fn(), update: jest.fn(() => saved.promise), remove: jest.fn(), restore: jest.fn() } })
    const user = await showAdas(deps)

    await user.press(screen.getByRole('checkbox', { name: 'Mark "Water the plants" as done' }))
    const stillBeas = await switchToBea(user, deps)
    await act(async () => saved.answer({ ...water, state: 'DONE' }))

    stillBeas()
    expect(screen.getByRole('checkbox', { name: 'Mark "Call the bank" as done' })).toBeEnabled()
  })

  it('neither puts the task back on the next account’s board nor signs it out when refused', async () => {
    const saved = late<BoardTask>()
    const deps = twoAccounts({ changes: { create: jest.fn(), update: jest.fn(() => saved.promise), remove: jest.fn(), restore: jest.fn() } })
    const user = await showAdas(deps)

    await user.press(screen.getByRole('checkbox', { name: 'Mark "Water the plants" as done' }))
    const stillBeas = await switchToBea(user, deps)
    await act(async () => saved.refuse(new SignedOutError()))

    stillBeas()
  })

  it('takes nothing off the next account’s board for a delete, nor offers to undo it', async () => {
    const removed = late<void>()
    const deps = twoAccounts({ changes: { create: jest.fn(), update: jest.fn(), remove: jest.fn(() => removed.promise), restore: jest.fn() } })
    const user = await showAdas(deps)

    await user.press(screen.getByRole('button', { name: 'Edit "Water the plants"' }))
    await user.press(screen.getByRole('button', { name: 'Delete' }))
    const stillBeas = await switchToBea(user, deps)
    await act(async () => removed.answer())

    stillBeas()
    expect(screen.queryByText('Task deleted')).toBeNull()
  })

  it('puts nothing back on the next account’s board for an undo', async () => {
    const restored = late<BoardTask>()
    const deps = twoAccounts({
      changes: { create: jest.fn(), update: jest.fn(), remove: jest.fn().mockResolvedValue(undefined), restore: jest.fn(() => restored.promise) },
    })
    const user = await showAdas(deps)

    await user.press(screen.getByRole('button', { name: 'Edit "Water the plants"' }))
    await user.press(screen.getByRole('button', { name: 'Delete' }))
    await user.press(await screen.findByRole('button', { name: 'Undo' }))
    const stillBeas = await switchToBea(user, deps)
    await act(async () => restored.answer({ ...water, id: 11 }))

    stillBeas()
  })

  it('attaches no file to the next account’s task of the same id', async () => {
    const uploaded = late<ReturnType<typeof attached>>()
    const deps = twoAccounts({
      attachments: { link: jest.fn(linkTo), remove: jest.fn(), upload: jest.fn(() => uploaded.promise) },
      pickFile: jest.fn().mockResolvedValue(photo),
    })
    const user = await showAdas(deps)

    await user.press(screen.getByRole('button', { name: 'Edit "Water the plants"' }))
    await user.press(screen.getByRole('button', { name: 'Take a photo' }))
    await user.press(screen.getByRole('button', { name: 'Cancel' }))
    const stillBeas = await switchToBea(user, deps)
    await act(async () => uploaded.answer(attached(photo, 9)))

    stillBeas()
    expect(within(screen.getByTestId('task-1')).queryByRole('button', { name: 'Open photo.jpg' })).toBeNull()
  })

  it('does not sign the next account out when an upload says the session had ended', async () => {
    const uploaded = late<ReturnType<typeof attached>>()
    const deps = twoAccounts({
      attachments: { link: jest.fn(linkTo), remove: jest.fn(), upload: jest.fn(() => uploaded.promise) },
      pickFile: jest.fn().mockResolvedValue(photo),
    })
    const user = await showAdas(deps)

    await user.press(screen.getByRole('button', { name: 'Edit "Water the plants"' }))
    await user.press(screen.getByRole('button', { name: 'Take a photo' }))
    await user.press(screen.getByRole('button', { name: 'Cancel' }))
    const stillBeas = await switchToBea(user, deps)
    await act(async () => uploaded.refuse(new SignedOutError()))

    stillBeas()
  })

  it('sends none of the files still waiting as the next account', async () => {
    const uploaded = late<ReturnType<typeof attached>>()
    const upload = jest.fn().mockReturnValueOnce(uploaded.promise).mockImplementation((_caller, _taskId, file: PickedFile) => Promise.resolve(attached(file, 8)))
    const deps = twoAccounts({
      changes: { create: jest.fn(async (_caller, input) => ({ ...input, id: 10 })), update: jest.fn(), remove: jest.fn(), restore: jest.fn() },
      attachments: { link: jest.fn(linkTo), remove: jest.fn(), upload },
      pickFile: jest.fn().mockResolvedValueOnce(photo).mockResolvedValueOnce(scan),
    })
    const user = await showAdas(deps)

    await user.press(screen.getByRole('button', { name: 'Add a task' }))
    await user.type(screen.getByLabelText('What needs doing'), 'Renew the passport')
    await user.press(screen.getByRole('button', { name: 'Take a photo' }))
    await user.press(screen.getByRole('button', { name: 'Choose a file' }))
    await user.press(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    await user.press(screen.getByRole('button', { name: 'Cancel' }))
    const stillBeas = await switchToBea(user, deps)
    await act(async () => uploaded.answer(attached(photo, 9)))

    stillBeas()
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('removes no file from the next account’s board', async () => {
    const gone = late<void>()
    const withScan: BoardTask = { ...water, attachments: [attached(scan, 5)] }
    const deps = twoAccounts({
      fetchTasks: jest.fn().mockResolvedValueOnce([withScan]).mockResolvedValue([bank]),
      attachments: { link: jest.fn(linkTo), remove: jest.fn(() => gone.promise) },
    })
    const user = await showAdas(deps)

    await user.press(screen.getByRole('button', { name: 'Edit "Water the plants"' }))
    await user.press(await screen.findByRole('button', { name: 'Remove scan.pdf' }))
    await user.press(screen.getByRole('button', { name: 'Cancel' }))
    const stillBeas = await switchToBea(user, deps)
    await act(async () => gone.answer())

    stillBeas()
  })
})

describe('an answer for the account signed out of, found in review (#428)', () => {
  const withScan: BoardTask = { ...water, attachments: [attached(scan, 5)] }

  it('does not sign the next account out when a file’s link says the session had ended', async () => {
    const linked = late<string>()
    const deps = twoAccounts({
      fetchTasks: jest.fn().mockResolvedValueOnce([withScan]).mockResolvedValue([bank]),
      attachments: { link: jest.fn(() => linked.promise), remove: jest.fn() },
      documents: { open: jest.fn(), forget: jest.fn().mockResolvedValue(undefined) },
    })
    const user = await showAdas(deps)

    await user.press(screen.getByRole('button', { name: 'Open scan.pdf' }))
    const stillBeas = await switchToBea(user, deps)
    await act(async () => linked.refuse(new SignedOutError()))

    stillBeas()
  })

  it('still says the account was deleted when a file was opened while it signed out', async () => {
    const sessions = slowKeychain(session)
    const deps = dependencies({
      sessions,
      fetchTasks: jest.fn().mockResolvedValue([withScan]),
      deleteAccount: jest.fn(async () => sessions.hold('clear')),
      attachments: { link: jest.fn(linkTo), remove: jest.fn() },
      documents: { open: jest.fn(), forget: jest.fn().mockResolvedValue(undefined) },
    })
    const user = await showAdas(deps)

    await user.press(screen.getByRole('button', { name: 'Account' }))
    await confirmDelete(user)
    await user.press(screen.getByRole('button', { name: 'Open scan.pdf' }))
    await act(async () => sessions.letGo())

    expect(
      await screen.findByText('Your account has been deleted. Signing in again starts a new, empty one.'),
    ).toBeOnTheScreen()
    expect(screen.queryByText('Your session has expired. Sign in again to carry on.')).toBeNull()
  })

  // Another change finding the session ended signs out while the delete is on its way.
  it.each([
    ['deleted', (deleted: ReturnType<typeof late<void>>) => deleted.answer()],
    ['refused', (deleted: ReturnType<typeof late<void>>) => deleted.refuse(new SignedOutError())],
  ])('does not sign the next account out when the delete is %s late', async (_answer, settle) => {
    const saved = late<BoardTask>()
    const deleted = late<void>()
    const deps = twoAccounts({
      changes: { create: jest.fn(), update: jest.fn(() => saved.promise), remove: jest.fn(), restore: jest.fn() },
      deleteAccount: jest.fn(() => deleted.promise),
    })
    const user = await showAdas(deps)

    await user.press(screen.getByRole('checkbox', { name: 'Mark "Water the plants" as done' }))
    await user.press(screen.getByRole('button', { name: 'Account' }))
    await confirmDelete(user)
    await act(async () => saved.refuse(new SignedOutError()))
    await user.press(await screen.findByRole('button', { name: 'Sign in with Keycloak' }))
    await screen.findByText('Call the bank')
    await act(async () => settle(deleted))

    expect(screen.getByText('Call the bank')).toBeOnTheScreen()
    expect(screen.queryByText('Your account has been deleted. Signing in again starts a new, empty one.')).toBeNull()
    expect((deps.sessions as ReturnType<typeof memorySessions>).current()).toMatchObject({ idToken: beasToken })
  })

  it('leaves the next account’s upload, and how far it has got, to it', async () => {
    const uploads: { progress: (fraction: number) => void; done: ReturnType<typeof late<ReturnType<typeof attached>>> }[] = []
    const upload = jest.fn((_caller, _taskId, _file: PickedFile, progress: (fraction: number) => void) => {
      const done = late<ReturnType<typeof attached>>()
      uploads.push({ progress, done })
      return done.promise
    })
    const deps = twoAccounts({
      fetchTasks: jest.fn().mockResolvedValueOnce([water]).mockResolvedValue([{ ...bank, id: 2 }]),
      attachments: { link: jest.fn(linkTo), remove: jest.fn(), upload },
      pickFile: jest.fn().mockResolvedValueOnce(photo).mockResolvedValueOnce(scan),
    })
    const user = await showAdas(deps)

    await user.press(screen.getByRole('button', { name: 'Edit "Water the plants"' }))
    await user.press(screen.getByRole('button', { name: 'Take a photo' }))
    await user.press(screen.getByRole('button', { name: 'Cancel' }))
    await switchToBea(user, deps)
    await user.press(screen.getByRole('button', { name: 'Edit "Call the bank"' }))
    const editor = await screen.findByTestId('task-form')
    expect(within(editor).queryByText('Uploading photo.jpg')).toBeNull()
    await user.press(within(editor).getByRole('button', { name: 'Choose a file' }))
    await act(async () => uploads[1].progress(0.42))
    await act(async () => uploads[0].progress(0.9))
    await act(async () => uploads[0].done.answer(attached(photo, 9)))

    expect(within(editor).getByText('Uploading scan.pdf')).toBeOnTheScreen()
    expect(within(editor).getByText('42%')).toBeOnTheScreen()
  })
})

describe('the legal pages before signing in (#275)', () => {
  it('are linked from the sign-in, with the release', async () => {
    await render(
      <TaskFestApp variant={variants.dev} language="en" dependencies={dependencies({ sessions: memorySessions(null) })} />,
    )
    const user = userEvent.setup()
    const legal = await screen.findByTestId('legal')

    await user.press(within(legal).getByRole('link', { name: 'Imprint' }))

    expect(Linking.openURL).toHaveBeenCalledWith('https://www.hilling.it/impressum/')
    expect(within(legal).getByRole('link', { name: 'Privacy' })).toBeOnTheScreen()
    expect(within(legal).getByRole('link', { name: 'Terms' })).toBeOnTheScreen()
    expect(within(legal).getByText('Version 1.2.0')).toBeOnTheScreen()
  })
})
