import { render } from '@testing-library/react-native'
import { StatusBar } from 'expo-status-bar'
import { TaskFestApp } from './TaskFestApp'
import { dependencies, memorySessions, prod } from './testing'

jest.mock('expo-status-bar', () => ({ StatusBar: jest.fn(() => null) }))

describe('the status bar (#662)', () => {
  it("follows the phone's theme, as the app's colours do", async () => {
    await render(<TaskFestApp variant={prod} language="en" dependencies={dependencies({ sessions: memorySessions(null) })} />)

    expect(jest.mocked(StatusBar).mock.lastCall?.[0]).toEqual({ style: 'auto' })
  })
})
