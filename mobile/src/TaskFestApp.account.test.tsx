import { act, render, screen, userEvent, within } from '@testing-library/react-native'
import { AppState, Linking } from 'react-native'
import { RequestFailedError, SignedOutError, type BoardTask } from './api'
import type { Session } from './session'
import type { SessionStore, Tokens } from './staySignedIn'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import { variants } from './variants'
import type { Language } from './web'

jest.mock('./DueDatePicker', () => ({ DueDatePicker: () => null }))

const NOW = Date.UTC(2026, 9, 10, 9)
const HOUR = 3600 * 1000
const BASE = 'http://localhost:3000'

function tokenWith(payload: object) {
  const encoded = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${encoded}.signature`
}

const idToken = tokenWith({ exp: NOW / 1000 + 3600, email: 'ada@example.com' })
const session: Session = { idToken, refreshToken: 'r', expiresAt: NOW + HOUR, lastUsedAt: NOW }
const water: BoardTask = { id: 1, description: 'Water the plants', dueDate: '2026-10-10', importance: 'HIGH', state: 'TODO' }

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
    sessions: memorySessions(session),
    provider: { signIn: jest.fn(), refresh: jest.fn() },
    fetchTasks: jest.fn().mockResolvedValue([water]),
    fetchMinimumAppVersion: jest.fn().mockResolvedValue('0.0.0'),
    changes: { create: jest.fn(), update: jest.fn(), remove: jest.fn(), restore: jest.fn() },
    deleteAccount: jest.fn().mockResolvedValue(undefined),
    appVersion: '1.2.0',
    now: () => NOW,
    ...overrides,
  }
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

/** Hands back what the app does when it comes back to the foreground. */
function foreground() {
  let onChange: (state: string) => void = () => undefined
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    onChange = listener as (state: string) => void
    return { remove: jest.fn() } as never
  })
  return () => act(async () => onChange('active'))
}

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

  it('leaves no sheet behind when a refused delete answers after the sign-out', async () => {
    let refuse: () => void = () => undefined
    const deleteAccount = jest.fn(() => new Promise<void>((_resolve, reject) => (refuse = () => reject(new RequestFailedError(500)))))
    const signIn = jest.fn().mockResolvedValue({ idToken, refreshToken: 'r' })
    const { user } = await openAccount({ deleteAccount, provider: { signIn, refresh: jest.fn() } })

    await confirmDelete(user)
    await user.press(screen.getByRole('button', { name: 'Sign out' }))
    await act(async () => refuse())
    await user.press(await screen.findByRole('button', { name: 'Sign in with Keycloak' }))

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
    expect(screen.queryByText('Signed in as ada@example.com')).toBeNull()
    expect(screen.queryByText('Unable to delete your account.')).toBeNull()
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
