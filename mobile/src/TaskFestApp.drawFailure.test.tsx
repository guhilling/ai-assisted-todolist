import { render, screen, userEvent } from '@testing-library/react-native'
import { TaskFestApp } from './TaskFestApp'
import { dependencies, memorySessions, session } from './testing'
import { variants } from './variants'

/**
 * An error while the board is drawn (#687): v1.8.1's upload progress, a BigInt on iOS, ended the
 * app mid-upload (#682). Now a message stands in for the board, and Try again draws it again.
 */

/** Which of the board's parts throw while drawn; each test sets its own. */
const mockBroken = { board: false, form: false }

jest.mock('./BoardScreen', () => {
  const actual = jest.requireActual('./BoardScreen')
  return {
    ...actual,
    BoardScreen: (props: object) => {
      if (mockBroken.board) {
        throw new Error('The board broke')
      }
      return actual.BoardScreen(props)
    },
  }
})

jest.mock('./TaskForm', () => {
  const actual = jest.requireActual('./TaskForm')
  return {
    ...actual,
    TaskForm: (props: object) => {
      if (mockBroken.form) {
        throw new Error('The form broke')
      }
      return actual.TaskForm(props)
    },
  }
})

const FAILED = 'Your tasks could not be shown. Nothing saved is lost.'

beforeEach(() => {
  mockBroken.board = false
  mockBroken.form = false
  // React reports every error it catches on the console.
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('an error while the board is drawn (#687)', () => {
  it('shows a message instead of ending the app, and Try again draws the board again', async () => {
    mockBroken.board = true
    const sessions = memorySessions(session)
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={dependencies({ sessions })} />)

    expect(await screen.findByText(FAILED)).toBeOnTheScreen()
    mockBroken.board = false
    await userEvent.setup().press(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
    expect(screen.queryByText(FAILED)).toBeNull()
    expect(sessions.current()).toEqual(session)
  })

  it('closes the sheet it came from, so that Try again shows the board', async () => {
    const user = userEvent.setup()
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={dependencies()} />)
    mockBroken.form = true

    await user.press(await screen.findByRole('button', { name: 'Edit "Water the plants"' }))
    expect(await screen.findByText(FAILED)).toBeOnTheScreen()
    await user.press(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
    expect(screen.queryByTestId('task-form')).toBeNull()
  })

  it('says it in German too', async () => {
    mockBroken.board = true
    await render(<TaskFestApp variant={variants.dev} language="de" dependencies={dependencies()} />)

    expect(
      await screen.findByText('Deine Aufgaben konnten nicht angezeigt werden. Gespeichertes geht dabei nicht verloren.'),
    ).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Noch einmal versuchen' })).toBeOnTheScreen()
  })
})
