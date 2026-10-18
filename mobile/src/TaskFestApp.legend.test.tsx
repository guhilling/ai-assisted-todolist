import { render, screen, userEvent } from '@testing-library/react-native'
import type { Session } from './session'
import type { SessionStore } from './staySignedIn'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import { light } from './theme'
import { variants } from './variants'
import type { Task } from './web'

/**
 * The board's colours explained on first use (#335), as on the website: the importance dots and
 * the red date, above the first board with tasks, until dismissed once on this phone.
 */

const NOW = Date.UTC(2026, 9, 10, 9)
const HOUR = 3600 * 1000
const session: Session = { idToken: 'stored', refreshToken: 'r', expiresAt: NOW + HOUR, lastUsedAt: NOW }
const tasks: Task[] = [{ id: 1, description: 'Pack the suitcase', dueDate: '2026-10-11', importance: 'HIGH', state: 'TODO' }]
const LEGEND = 'Importance: High, Medium, Low.'

function legend(seen = false) {
  return { seen: jest.fn().mockResolvedValue(seen), dismiss: jest.fn().mockResolvedValue(undefined) }
}

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  const sessions: SessionStore = { save: async () => undefined, load: async () => session, clear: async () => undefined }
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
    ...overrides,
  }
}

describe('the colours, explained on first use (#335)', () => {
  it('explains the importance dots and the red date above the first board with tasks', async () => {
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={dependencies({ legend: legend() })} />)

    expect(await screen.findByLabelText(LEGEND)).toBeOnTheScreen()
  })

  it('goes once dismissed, and is remembered', async () => {
    const remembered = legend()
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={dependencies({ legend: remembered })} />)

    await userEvent.setup().press(await screen.findByRole('button', { name: 'Got it' }))

    expect(screen.queryByLabelText(LEGEND)).toBeNull()
    expect(remembered.dismiss).toHaveBeenCalled()
  })

  it('is not shown again once dismissed', async () => {
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={dependencies({ legend: legend(true) })} />)
    await screen.findByText('Pack the suitcase')

    expect(screen.queryByLabelText(LEGEND)).toBeNull()
  })

  it('waits while there are no tasks to explain', async () => {
    await render(
      <TaskFestApp variant={variants.dev} language="en" dependencies={dependencies({ legend: legend(), fetchTasks: jest.fn().mockResolvedValue([]) })} />,
    )
    await screen.findByText('Nothing here yet.')

    expect(screen.queryByLabelText(LEGEND)).toBeNull()
  })

  it('speaks German too', async () => {
    await render(<TaskFestApp variant={variants.dev} language="de" dependencies={dependencies({ legend: legend() })} />)

    expect(await screen.findByLabelText('Wichtigkeit: Hoch, Mittel, Niedrig.')).toBeOnTheScreen()
    expect(screen.getByText('Ein Datum in Rot ist überfällig.')).toBeOnTheScreen()
  })

  it('shows an overdue date in red, as the legend says and as the website does', async () => {
    const late: Task = { id: 2, description: 'Renew the passport', dueDate: '2026-10-08', importance: 'LOW', state: 'TODO' }
    await render(
      <TaskFestApp
        variant={variants.dev}
        language="en"
        dependencies={dependencies({ legend: legend(), fetchTasks: jest.fn().mockResolvedValue([...tasks, late]) })}
      />,
    )

    expect(await screen.findByText('2 days ago')).toHaveStyle({ color: light.danger })
    expect(screen.getByText('A date in red is overdue.')).toBeOnTheScreen()
  })
})
