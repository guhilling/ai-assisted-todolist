import { render, screen, within } from '@testing-library/react-native'
import type { Session } from './session'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import { HOUR, dependencies as appDependencies, memorySessions } from './testing'
import { variants } from './variants'
import type { Task } from './web'

/**
 * A task's due time on the board (#475), which the app shows but cannot set yet. The moments are
 * built on the phone's own clock, so the tests hold in any time zone: what is "here" is whatever
 * the clock reads, and the zone a task names is only its label.
 */

// Local noon on 10 October 2026, a Saturday.
const NOW = new Date(2026, 9, 10, 12).getTime()
const session: Session = { idToken: 'stored', refreshToken: 'r', expiresAt: NOW + HOUR, lastUsedAt: NOW }
const localMoment = (day: number, hour: number) => new Date(2026, 9, day, hour).toISOString()

const tasks: Task[] = [
  { id: 1, description: 'Call the bank', dueDate: '2026-10-10', dueTime: '10:00', importance: 'HIGH', state: 'TODO' },
  {
    id: 2, description: 'Join the stand-up', dueDate: '2026-10-10', dueTime: '10:00', timeZone: 'Asia/Tokyo',
    dueAt: localMoment(10, 4), importance: 'MEDIUM', state: 'TODO',
  },
  {
    id: 3, description: 'Ring Grandma', dueDate: '2026-10-14', dueTime: '01:00', timeZone: 'America/New_York',
    dueAt: localMoment(13, 19), importance: 'LOW', state: 'TODO',
  },
  { id: 4, description: 'Water the plants', dueDate: '2026-10-10', importance: 'LOW', state: 'TODO' },
]

function dependencies(): Dependencies {
  return appDependencies({
    sessions: memorySessions(session),
    fetchTasks: jest.fn().mockResolvedValue(tasks),
    reminders: {
      permission: jest.fn().mockResolvedValue('denied'),
      ask: jest.fn(),
      replace: jest.fn().mockResolvedValue(undefined),
      answered: jest.fn().mockResolvedValue(true),
      decline: jest.fn(),
    },
    now: () => NOW,
  })
}

describe("a task's due time on the board (#475)", () => {
  it('shows the time of a task that follows wherever its owner is', async () => {
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={dependencies()} />)

    expect(within(await screen.findByTestId('task-1')).getByText('10:00')).toBeOnTheScreen()
  })

  it("shows a zoned task's time there and here", async () => {
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={dependencies()} />)

    expect(within(await screen.findByTestId('task-2')).getByText('10:00 (Tokyo), 04:00 here')).toBeOnTheScreen()
  })

  it("files a zoned task under its own date, and names both days when here's differs", async () => {
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={dependencies()} />)

    const row = await screen.findByTestId('task-3')
    expect(within(row).getByText('Wed')).toBeOnTheScreen()
    expect(within(row).getByText('Wed 01:00 (New York), Tue 19:00 here')).toBeOnTheScreen()
  })

  it('reads the due time aloud with the task', async () => {
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={dependencies()} />)

    expect(await screen.findByLabelText('Edit "Join the stand-up", due 10:00 (Tokyo), 04:00 here')).toBeOnTheScreen()
    expect(screen.getByLabelText('Edit "Water the plants"')).toBeOnTheScreen()
  })

  it('shows no time on a task without one', async () => {
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={dependencies()} />)

    expect(within(await screen.findByTestId('task-4')).queryByText(/\d\d:\d\d/)).toBeNull()
  })

  it('in the language the app speaks', async () => {
    await render(<TaskFestApp variant={variants.dev} language="de" dependencies={dependencies()} />)

    expect(within(await screen.findByTestId('task-2')).getByText('10:00 (Tokyo), hier 04:00')).toBeOnTheScreen()
  })
})
