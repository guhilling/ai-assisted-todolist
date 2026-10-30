import { render, screen } from '@testing-library/react-native'
import type { Session } from './session'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import { HOUR, dependencies as appDependencies, memorySessions } from './testing'
import { variants } from './variants'
import type { Task } from './web'

/**
 * The weekday beside "Today" and "Tomorrow" (#337), as on the website: beside the board's
 * headings, which keep their names, and beside a completed task's "Today". 10 October 2026 is a
 * Saturday.
 */

// Local noon, not the shared NOW, so it is 10 October on the phone's clock in any time zone.
const NOW = new Date(2026, 9, 10, 12).getTime()
const session: Session = { idToken: 'stored', refreshToken: 'r', expiresAt: NOW + HOUR, lastUsedAt: NOW }

const tasks: Task[] = [
  { id: 1, description: 'Water the plants', dueDate: '2026-10-10', importance: 'HIGH', state: 'TODO' },
  { id: 2, description: 'Book the train', dueDate: '2026-10-11', importance: 'LOW', state: 'TODO' },
  { id: 3, description: 'Pay the rent', dueDate: '2026-10-13', importance: 'MEDIUM', state: 'TODO' },
  { id: 4, description: 'Post the letter', dueDate: '2026-10-10', importance: 'MEDIUM', state: 'DONE' },
]

function dependencies(): Dependencies {
  return appDependencies({
    sessions: memorySessions(session),
    fetchTasks: jest.fn().mockResolvedValue(tasks),
    reminders: { permission: jest.fn().mockResolvedValue('denied'), ask: jest.fn(), replace: jest.fn().mockResolvedValue(undefined), answered: jest.fn().mockResolvedValue(true), decline: jest.fn() },
    now: () => NOW,
  })
}

describe('the weekday beside today and tomorrow (#337)', () => {
  it('names the day beside the Today and Tomorrow headings, which keep their names', async () => {
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={dependencies()} />)

    expect(await screen.findByText('Today')).toBeOnTheScreen()
    expect(screen.getByText('Tomorrow')).toBeOnTheScreen()
    expect(screen.getByTestId('weekday-today')).toHaveTextContent('Saturday')
    expect(screen.getByTestId('weekday-tomorrow')).toHaveTextContent('Sunday')
    // "This week" lists its weekdays on the rows already.
    expect(screen.queryByTestId('weekday-thisWeek')).toBeNull()
  })

  it('reads the heading and its day aloud as one', async () => {
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={dependencies()} />)

    expect(await screen.findByLabelText('Today · Saturday')).toBeOnTheScreen()
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
