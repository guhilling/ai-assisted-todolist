import { render, screen, userEvent } from '@testing-library/react-native'
import type { BoardTask } from './api'
import type { ReminderPermission, ReminderScheduler } from './notifications'
import type { Session } from './session'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import { HOUR, dependencies as appDependencies, memorySessions, tokenWith } from './testing'
import { variants } from './variants'

jest.mock('./DueDatePicker', () => ({ DueDatePicker: () => null }))

/** 10 October 2026, 06:00 on the phone's clock: before any 08:00 the tests look at. Not the shared NOW, which is UTC. */
const NOW = new Date(2026, 9, 10, 6, 0).getTime()
const OFFER = 'Get a reminder at 08:00 on days tasks are due?'

// Ada signed in on this clock, and a board to be reminded of: two tasks due tomorrow, one overdue.
const idToken = tokenWith({ exp: NOW / 1000 + 3600, email: 'ada@example.com' })
const session: Session = { idToken, refreshToken: 'r', expiresAt: NOW + HOUR, lastUsedAt: NOW }
const water: BoardTask = { id: 1, description: 'Water the plants', dueDate: '2026-10-11', importance: 'HIGH', state: 'TODO' }
const train: BoardTask = { id: 2, description: 'Book the train', dueDate: '2026-10-11', importance: 'LOW', state: 'TODO' }
const rent: BoardTask = { id: 3, description: 'Pay the rent', dueDate: '2026-10-01', importance: 'MEDIUM', state: 'TODO' }

const at8 = (day: number) => new Date(2026, 9, day, 8, 0)

function scheduler(permission: ReminderPermission, { declined = false, allows = true } = {}) {
  let current = permission
  return {
    permission: jest.fn(async () => current),
    ask: jest.fn(async () => {
      current = allows ? 'granted' : 'denied'
      return allows
    }),
    replace: jest.fn().mockResolvedValue(undefined),
    answered: jest.fn().mockResolvedValue(declined),
    decline: jest.fn().mockResolvedValue(undefined),
  } satisfies ReminderScheduler
}

/** The board above, a backend that agrees to every change, and the reminders allowed. */
function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return appDependencies({
    sessions: memorySessions(session),
    fetchTasks: jest.fn().mockResolvedValue([water, train, rent]),
    changes: { create: jest.fn(), update: jest.fn(async (_caller, task) => task), remove: jest.fn(), restore: jest.fn() },
    reminders: scheduler('granted'),
    now: () => NOW,
    ...overrides,
  })
}

async function start(overrides: Partial<Dependencies> = {}) {
  const deps = dependencies(overrides)
  await render(<TaskFestApp variant={variants.dev} language="en" dependencies={deps} />)
  await screen.findByText('Water the plants')
  return { deps, user: userEvent.setup() }
}

describe('the due-day reminders, from the app (#273)', () => {
  it('schedules the reminders for the board it loads', async () => {
    const reminders = scheduler('granted')
    await start({ reminders })

    expect(reminders.replace).toHaveBeenLastCalledWith([{ at: at8(11), title: '2 tasks due today' }])
  })

  it('schedules them anew after a change, so a completed task never reminds', async () => {
    const reminders = scheduler('granted')
    const { user } = await start({ reminders })

    await user.press(screen.getByRole('checkbox', { name: 'Mark "Water the plants" as done' }))
    await screen.findByText('Completed (1)')

    expect(reminders.replace).toHaveBeenLastCalledWith([{ at: at8(11), title: '1 task due today' }])
  })

  it('clears them on signing out', async () => {
    const reminders = scheduler('granted')
    const { user } = await start({ reminders })

    await user.press(screen.getByRole('button', { name: 'Account' }))
    await user.press(screen.getByRole('button', { name: 'Sign out' }))

    await screen.findByRole('button', { name: 'Sign in with Keycloak' })
    expect(reminders.replace).toHaveBeenLastCalledWith([])
  })

  it('offers them once there is a task to be reminded of, and turns them on when asked', async () => {
    const reminders = scheduler('undetermined')
    const { user } = await start({ reminders })

    expect(await screen.findByText(OFFER)).toBeOnTheScreen()
    expect(reminders.ask).not.toHaveBeenCalled()
    await user.press(screen.getByRole('button', { name: 'Turn on' }))

    expect(reminders.ask).toHaveBeenCalled()
    expect(screen.queryByText(OFFER)).toBeNull()
    expect(reminders.replace).toHaveBeenLastCalledWith([{ at: at8(11), title: '2 tasks due today' }])
  })

  it('carries on without them when the platform is refused', async () => {
    const reminders = scheduler('undetermined', { allows: false })
    const { user } = await start({ reminders })

    await user.press(await screen.findByRole('button', { name: 'Turn on' }))

    expect(screen.queryByText(OFFER)).toBeNull()
    expect(screen.getByText('Water the plants')).toBeOnTheScreen()
  })

  it('does not offer them again once declined', async () => {
    const reminders = scheduler('undetermined')
    const { user } = await start({ reminders })

    await user.press(await screen.findByRole('button', { name: 'Not now' }))

    expect(reminders.decline).toHaveBeenCalled()
    expect(screen.queryByText(OFFER)).toBeNull()
    expect(reminders.ask).not.toHaveBeenCalled()
  })

  it('offers nothing when they were declined before, or refused, or are on already', async () => {
    for (const reminders of [scheduler('undetermined', { declined: true }), scheduler('denied'), scheduler('granted')]) {
      const { unmount } = await render(
        <TaskFestApp variant={variants.dev} language="en" dependencies={dependencies({ reminders })} />,
      )
      await screen.findByText('Water the plants')
      expect(screen.queryByText(OFFER)).toBeNull()
      await unmount()
    }
  })

  it('offers nothing while there is nothing to be reminded of', async () => {
    const reminders = scheduler('undetermined')
    await start({ reminders, fetchTasks: jest.fn().mockResolvedValue([rent, { ...water, state: 'DONE' }]) })

    expect(screen.queryByText(OFFER)).toBeNull()
  })

  it('carries on when the phone will not schedule, ask or remember anything', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const broken = {
      permission: jest.fn().mockResolvedValueOnce('undetermined').mockRejectedValue(new Error('no')),
      ask: jest.fn().mockRejectedValue(new Error('no')),
      replace: jest.fn().mockRejectedValue(new Error('no')),
      answered: jest.fn().mockResolvedValue(false),
      decline: jest.fn().mockRejectedValue(new Error('no')),
    } satisfies ReminderScheduler
    const { user } = await start({ reminders: broken })

    await user.press(await screen.findByRole('button', { name: 'Turn on' }))
    expect(screen.queryByText(OFFER)).toBeNull()

    await user.press(screen.getByRole('button', { name: 'Account' }))
    await user.press(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('button', { name: 'Sign in with Keycloak' })).toBeOnTheScreen()
    expect(console.warn).toHaveBeenCalledWith('The reminders could not be cleared', expect.any(Error))
  })

  it('carries on when the declined offer cannot be remembered', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const reminders = { ...scheduler('undetermined'), decline: jest.fn().mockRejectedValue(new Error('disk')) }
    const { user } = await start({ reminders })

    await user.press(await screen.findByRole('button', { name: 'Not now' }))

    expect(screen.queryByText(OFFER)).toBeNull()
    await screen.findByText('Water the plants')
    expect(console.warn).toHaveBeenCalledWith('The declined offer could not be kept', expect.any(Error))
  })

  it('offers nothing when the phone cannot say whether it may', async () => {
    const reminders = { ...scheduler('undetermined'), permission: jest.fn().mockRejectedValue(new Error('no')) }
    await start({ reminders })

    expect(screen.queryByText(OFFER)).toBeNull()
  })

  it('clears them when the session ran out unused', async () => {
    const reminders = scheduler('granted')
    const stale = { ...session, lastUsedAt: NOW - 31 * 24 * HOUR }
    await render(
      <TaskFestApp variant={variants.dev} language="en" dependencies={dependencies({ reminders, sessions: memorySessions(stale) })} />,
    )

    await screen.findByRole('button', { name: 'Sign in with Keycloak' })
    expect(reminders.replace).toHaveBeenCalledWith([])
  })
})

describe('what the offer says before the phone asks (#336)', () => {
  it('says what will come, and that the phone asks next, before anything is asked', async () => {
    const reminders = scheduler('undetermined')
    await start({ reminders })

    expect(await screen.findByText(OFFER)).toBeOnTheScreen()
    expect(
      screen.getByText('One notification at 08:00 on those days: how many tasks are due, not which. If your phone asks next, allow it.'),
    ).toBeOnTheScreen()
    expect(reminders.ask).not.toHaveBeenCalled()
  })

  it('says it in German too', async () => {
    const reminders = scheduler('undetermined')
    await render(<TaskFestApp variant={variants.dev} language="de" dependencies={dependencies({ reminders })} />)

    expect(
      await screen.findByText('An solchen Tagen um 8:00 eine Mitteilung: wie viele Aufgaben fällig sind, nicht welche. Fragt dein Telefon gleich danach, erlaube sie.'),
    ).toBeOnTheScreen()
    expect(reminders.ask).not.toHaveBeenCalled()
  })
})
