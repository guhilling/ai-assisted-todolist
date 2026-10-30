import { render, screen, userEvent, within } from '@testing-library/react-native'
import type { Dependencies } from './TaskFestApp'
import { TaskFestApp } from './TaskFestApp'
import { dependencies as appDependencies, memorySessions, prod, qa } from './testing'
import { googleSignInButton } from './web'

let mockScheme: 'light' | 'dark' = 'light'
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: () => mockScheme }))

/** Nobody signed in, nothing on the board, and a Google sign-in that is turned back from. */
function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return appDependencies({
    sessions: memorySessions(null),
    google: { signIn: jest.fn().mockResolvedValue(null), renew: jest.fn(), signOut: jest.fn() },
    fetchTasks: jest.fn().mockResolvedValue([]),
    now: () => Date.UTC(2026, 9, 18, 9),
    ...overrides,
  })
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
