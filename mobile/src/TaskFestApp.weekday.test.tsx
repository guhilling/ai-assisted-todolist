import { render, screen } from '@testing-library/react-native'
import type { Session } from './session'
import type { SessionStore } from './staySignedIn'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import { variants } from './variants'
import type { Task } from './web'

/**
 * The weekday beside "Today" and "Tomorrow" (#337), as on the website: beside the board's
 * headings, which keep their names, and beside a completed task's "Today". 10 October 2026 is a
 * Saturday.
 */

const NOW = Date.UTC(2026, 9, 10, 9)
const HOUR = 3600 * 1000
const session: Session = { idToken: 'stored', refreshToken: 'r', expiresAt: NOW + HOUR, lastUsedAt: NOW }

const tasks: Task[] = [
  { id: 1, description: 'Water the plants', dueDate: '2026-10-10', importance: 'HIGH', state: 'TODO' },
  { id: 2, description: 'Book the train', dueDate: '2026-10-11', importance: 'LOW', state: 'TODO' },
  { id: 3, description: 'Pay the rent', dueDate: '2026-10-13', importance: 'MEDIUM', state: 'TODO' },
  { id: 4, description: 'Post the letter', dueDate: '2026-10-10', importance: 'MEDIUM', state: 'DONE' },
]

function dependencies(): Dependencies {
  const sessions: SessionStore = {
    save: async () => undefined,
    load: async () => session,
    clear: async () => undefined,
  }
  return {
    sessions,
    provider: { signIn: jest.fn(), refresh: jest.fn() },
    fetchTasks: jest.fn().mockResolvedValue(tasks),
    fetchMinimumAppVersion: jest.fn().mockResolvedValue('0.0.0'),
    changes: { create: jest.fn(), update: jest.fn(), remove: jest.fn(), restore: jest.fn() },
    deleteAccount: jest.fn(),
    keptBoard: { load: jest.fn().mockResolvedValue(null), save: jest.fn().mockResolvedValue(undefined), clear: jest.fn().mockResolvedValue(undefined) },
    reminders: { permission: jest.fn().mockResolvedValue('denied'), ask: jest.fn(), replace: jest.fn().mockResolvedValue(undefined), answered: jest.fn().mockResolvedValue(true), decline: jest.fn() },
    appVersion: '1.2.0',
    now: () => NOW,
  }
}

describe('the weekday beside today and tomorrow (#337)', () => {
  it('names the day beside the Today and Tomorrow headings, which keep their names', async () => {
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={dependencies()} />)

    expect(await screen.findByText('Today')).toBeOnTheScreen()
    expect(screen.getByText('Tomorrow')).toBeOnTheScreen()
    expect(screen.getByTestId('weekday-today')).toHaveTextContent('Saturday')
    expect(screen.getByTestId('weekday-tomorrow')).toHaveTextContent('Sunday')
    // "This week" lists its weekdays on the rows already.
    expect(screen.queryByTestId('weekday-week')).toBeNull()
  })

  it('names it beside a completed task done today too', async () => {
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={dependencies()} />)

    expect(await screen.findByText('Today · Saturday')).toBeOnTheScreen()
  })

  it('in the language the app speaks', async () => {
    await render(<TaskFestApp variant={variants.dev} language="de" dependencies={dependencies()} />)

    expect(await screen.findByText('Heute')).toBeOnTheScreen()
    expect(screen.getByTestId('weekday-today')).toHaveTextContent('Samstag')
  })
})
