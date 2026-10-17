import { render, screen, userEvent, within } from '@testing-library/react-native'
import type { Dependencies } from './TaskFestApp'
import { TaskFestApp } from './TaskFestApp'
import { variantOf } from './variants'
import { googleSignInButton } from './web'

let mockScheme: 'light' | 'dark' = 'light'
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: () => mockScheme }))

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

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    sessions: { save: jest.fn().mockResolvedValue(undefined), load: jest.fn().mockResolvedValue(null), clear: jest.fn().mockResolvedValue(undefined) },
    provider: { signIn: jest.fn(), refresh: jest.fn() },
    google: { signIn: jest.fn().mockResolvedValue(null), renew: jest.fn(), signOut: jest.fn() },
    fetchTasks: jest.fn().mockResolvedValue([]),
    fetchMinimumAppVersion: jest.fn().mockResolvedValue('0.0.0'),
    changes: { create: jest.fn(), update: jest.fn(), remove: jest.fn(), restore: jest.fn() },
    deleteAccount: jest.fn(),
    keptBoard: { load: jest.fn().mockResolvedValue(null), save: jest.fn().mockResolvedValue(undefined), clear: jest.fn().mockResolvedValue(undefined) },
    reminders: { permission: jest.fn().mockResolvedValue('denied'), ask: jest.fn(), replace: jest.fn().mockResolvedValue(undefined), answered: jest.fn().mockResolvedValue(false), decline: jest.fn() },
    appVersion: '1.2.0',
    now: () => Date.UTC(2026, 9, 18, 9),
    ...overrides,
  }
}

afterEach(() => {
  mockScheme = 'light'
})

describe("Google's own sign-in button (#325)", () => {
  it("is Google's official button, in Google's light theme", async () => {
    await render(<TaskFestApp variant={prod} language="en" dependencies={dependencies()} />)

    const button = await screen.findByRole('button', { name: 'Sign in with Google' })
    expect(within(button).getByTestId('google-sign-in-image')).toHaveProp('source', googleSignInButton.light)
  })

  it("is Google's dark button in a dark theme", async () => {
    mockScheme = 'dark'
    await render(<TaskFestApp variant={prod} language="en" dependencies={dependencies()} />)

    const button = await screen.findByRole('button', { name: 'Sign in with Google' })
    expect(within(button).getByTestId('google-sign-in-image')).toHaveProp('source', googleSignInButton.dark)
  })

  it("stays Google's English in German, as on the website", async () => {
    await render(<TaskFestApp variant={prod} language="de" dependencies={dependencies()} />)

    const button = await screen.findByRole('button', { name: 'Sign in with Google' })
    expect(button).toHaveProp('accessibilityLanguage', 'en')
    expect(screen.queryByText('Mit Google anmelden')).toBeNull()
  })

  it('starts the sign-in with Google', async () => {
    const google = { signIn: jest.fn().mockResolvedValue(null), renew: jest.fn(), signOut: jest.fn() }
    await render(<TaskFestApp variant={prod} language="en" dependencies={dependencies({ google })} />)

    await userEvent.setup().press(await screen.findByRole('button', { name: 'Sign in with Google' }))

    expect(google.signIn).toHaveBeenCalled()
  })

  it('starts one sign-in however often it is tapped while Google is busy', async () => {
    const google = { signIn: jest.fn().mockReturnValue(new Promise(() => undefined)), renew: jest.fn(), signOut: jest.fn() }
    await render(<TaskFestApp variant={prod} language="en" dependencies={dependencies({ google })} />)
    const user = userEvent.setup()
    const button = await screen.findByRole('button', { name: 'Sign in with Google' })

    await user.press(button)
    await user.press(button)

    expect(google.signIn).toHaveBeenCalledTimes(1)
  })

  it('is at least 48 points high to the finger', async () => {
    await render(<TaskFestApp variant={prod} language="en" dependencies={dependencies()} />)

    const button = await screen.findByRole('button', { name: 'Sign in with Google' })
    expect(button).toHaveProp('hitSlop', { top: 4, bottom: 4 })
  })

  it('leaves the test-account button as it was', async () => {
    await render(<TaskFestApp variant={qa} language="en" dependencies={dependencies()} />)

    const testAccount = await screen.findByRole('button', { name: 'Sign in with TaskFest test account' })
    expect(within(testAccount).queryByTestId('google-sign-in-image')).toBeNull()
    expect(within(testAccount).getByText('Sign in with TaskFest test account')).toBeOnTheScreen()
  })
})
