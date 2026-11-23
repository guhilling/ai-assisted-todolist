import { act, render, screen, userEvent } from '@testing-library/react-native'
import type { ExactAlarmOffer } from './notifications'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import { foreground, reminding } from './testing'
import { variants } from './variants'

jest.mock('./DueDatePicker', () => ({ DueDatePicker: () => null }))

const { rent, scheduler } = reminding
const LATE = 'Reminders may come late'

/** Exact alarms not allowed, and the offer not answered: what Android 14 starts with. */
function offer(wanted = true) {
  return {
    wanted: jest.fn().mockResolvedValue(wanted),
    allow: jest.fn().mockResolvedValue(undefined),
    decline: jest.fn().mockResolvedValue(undefined),
  } satisfies ExactAlarmOffer
}

/** The reminders' board and their permission, and exact alarms not allowed. */
function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return reminding.dependencies({ exactAlarms: offer(), ...overrides })
}

async function start(overrides: Partial<Dependencies> = {}, language: 'en' | 'de' = 'en') {
  const deps = dependencies(overrides)
  await render(<TaskFestApp variant={variants.dev} language={language} dependencies={deps} />)
  await screen.findByText('Water the plants')
  return { deps, user: userEvent.setup() }
}

describe('the offer to bring the reminders on time, on Android (#665)', () => {
  it('says they may come late, and opens the setting when asked', async () => {
    const exactAlarms = offer()
    const { user } = await start({ exactAlarms })

    expect(await screen.findByText(LATE)).toBeOnTheScreen()
    expect(
      screen.getByText(
        'Without the permission to set alarms and reminders, Android may bring them up to an hour late, and later while the phone lies unused. Allow it in the setting that opens next.',
      ),
    ).toBeOnTheScreen()
    await user.press(screen.getByRole('button', { name: 'Open settings' }))

    expect(exactAlarms.allow).toHaveBeenCalled()
    expect(screen.queryByText(LATE)).toBeNull()
  })

  it('is not made again once declined', async () => {
    const exactAlarms = offer()
    const { user } = await start({ exactAlarms })

    await user.press(await screen.findByRole('button', { name: 'Not now' }))

    expect(exactAlarms.decline).toHaveBeenCalled()
    expect(exactAlarms.allow).not.toHaveBeenCalled()
    expect(screen.queryByText(LATE)).toBeNull()
  })

  it('comes right after the reminders are turned on', async () => {
    const { user } = await start({ reminders: scheduler('undetermined') })

    expect(screen.queryByText(LATE)).toBeNull()
    await user.press(await screen.findByRole('button', { name: 'Turn on' }))

    expect(await screen.findByText(LATE)).toBeOnTheScreen()
  })

  it('is not made without the reminders, when they are on time already, or with nothing to remind of', async () => {
    for (const overrides of [
      { reminders: scheduler('denied') },
      { exactAlarms: offer(false) },
      { exactAlarms: undefined },
      { fetchTasks: jest.fn().mockResolvedValue([rent]) },
    ]) {
      const { unmount } = await render(
        <TaskFestApp variant={variants.dev} language="en" dependencies={dependencies(overrides)} />,
      )
      await screen.findByText('Pay the rent')
      expect(screen.queryByText(LATE)).toBeNull()
      await unmount()
    }
  })

  it('stays answered when a look begun before the answer comes back after it', async () => {
    // Back in the foreground, the start over looks again; Not now is tapped before that look ends.
    const back = foreground()
    let answer: (wanted: boolean) => void = () => undefined
    const exactAlarms = offer()
    const { user } = await start({ exactAlarms })
    await screen.findByText(LATE)
    exactAlarms.wanted.mockImplementationOnce(() => new Promise<boolean>((resolve) => (answer = resolve)))

    await back()
    await user.press(screen.getByRole('button', { name: 'Not now' }))
    await act(async () => answer(true))

    expect(screen.queryByText(LATE)).toBeNull()
  })

  it('carries on when the setting cannot be opened or the answer kept', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const exactAlarms = { ...offer(), allow: jest.fn().mockRejectedValue(new Error('no activity')) }
    const { user } = await start({ exactAlarms })

    await user.press(await screen.findByRole('button', { name: 'Open settings' }))

    expect(screen.queryByText(LATE)).toBeNull()
    expect(screen.getByText('Water the plants')).toBeOnTheScreen()
    expect(console.warn).toHaveBeenCalledWith('The setting for exact alarms could not be opened', expect.any(Error))
  })

  it('is not made when the phone cannot say whether they are allowed', async () => {
    await start({ exactAlarms: { ...offer(), wanted: jest.fn().mockRejectedValue(new Error('unavailable')) } })

    expect(screen.queryByText(LATE)).toBeNull()
  })

  it('says it in German too', async () => {
    await start({}, 'de')

    expect(await screen.findByText('Erinnerungen kommen vielleicht zu spät')).toBeOnTheScreen()
    expect(
      screen.getByText(
        'Ohne die Erlaubnis, Wecker und Erinnerungen zu stellen, kann Android sie bis zu einer Stunde später bringen, und noch später, wenn das Telefon unbenutzt liegt. Erlaube es in der Einstellung, die sich gleich öffnet.',
      ),
    ).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Einstellungen öffnen' })).toBeOnTheScreen()
  })
})
