import { render, screen, userEvent } from '@testing-library/react-native'
import { TaskFestApp } from './TaskFestApp'
import { dependencies, foreground, water } from './testing'
import { variants } from './variants'

/**
 * A change of the phone's time zone, followed without a restart (#526): Hermes keeps the zone it
 * started in for every `Date`, so the app has it dropped before it starts over in the foreground.
 */
describe("the phone's time zone after the app was away (#526)", () => {
  it('drops the cached time zone before the board is loaded again', async () => {
    const back = foreground()
    const calls: string[] = []
    const resetTimeZone = jest.fn(() => void calls.push('reset'))
    const fetchTasks = jest.fn(async () => {
      calls.push('load')
      return [water]
    })
    await render(
      <TaskFestApp variant={variants.dev} language="en" dependencies={dependencies({ fetchTasks, resetTimeZone })} />,
    )
    await screen.findByText('Water the plants')
    calls.length = 0

    await back()

    expect(calls.slice(0, 2)).toEqual(['reset', 'load'])
  })

  it('drops it even while a form is open, which keeps the board as it is', async () => {
    const back = foreground()
    const resetTimeZone = jest.fn()
    await render(<TaskFestApp variant={variants.dev} language="en" dependencies={dependencies({ resetTimeZone })} />)
    await userEvent.setup().press(await screen.findByRole('button', { name: 'Add a task' }))

    await back()

    expect(resetTimeZone).toHaveBeenCalledTimes(1)
  })

  it('loads the board again even when the time zone cannot be dropped', async () => {
    const back = foreground()
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const resetTimeZone = jest.fn(() => {
      throw new Error('The runtime is gone')
    })
    const fetchTasks = jest.fn().mockResolvedValue([water])
    await render(
      <TaskFestApp variant={variants.dev} language="en" dependencies={dependencies({ fetchTasks, resetTimeZone })} />,
    )
    await screen.findByText('Water the plants')

    await back()

    expect(fetchTasks).toHaveBeenCalledTimes(2)
  })
})
