import { render } from '@testing-library/react-native'
import { StatusBar } from 'expo-status-bar'
import { Platform } from 'react-native'
import { TaskFestApp } from './TaskFestApp'
import { dependencies, memorySessions, prod } from './testing'

let mockScheme: 'light' | 'dark' = 'light'
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: () => mockScheme }))
jest.mock('expo-status-bar', () => ({ StatusBar: jest.fn(() => null) }))

/** The style the app gives the status bar, or undefined when it leaves it alone. */
async function statusBarStyle() {
  await render(<TaskFestApp variant={prod} language="en" dependencies={dependencies({ sessions: memorySessions(null) })} />)
  return jest.mocked(StatusBar).mock.lastCall?.[0].style
}

describe('the status bar (#662)', () => {
  afterEach(() => {
    mockScheme = 'light'
    jest.restoreAllMocks()
    jest.mocked(StatusBar).mockClear()
  })

  it('has dark icons over the light theme on Android', async () => {
    jest.replaceProperty(Platform, 'OS', 'android')

    expect(await statusBarStyle()).toBe('dark')
  })

  it('has light icons over the dark theme on Android', async () => {
    jest.replaceProperty(Platform, 'OS', 'android')
    mockScheme = 'dark'

    expect(await statusBarStyle()).toBe('light')
  })

  it('is left to iOS on an iPhone', async () => {
    expect(await statusBarStyle()).toBeUndefined()
  })
})
