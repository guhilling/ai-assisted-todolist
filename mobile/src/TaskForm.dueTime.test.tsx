import { fireEvent, render, screen, userEvent } from '@testing-library/react-native'
import type { BoardTask } from './api'
import { stylesFor } from './styles'
import { TaskForm } from './TaskForm'
import { light } from './theme'
import { catalogues } from './web'

/**
 * A task's due time in the app's form (#477): the time from the platform's picker, the switch
 * that ties it to a zone, the zone picker, and clearing it.
 */

// The platform's pickers are native. This one picks half past two as Android's dialog does, done
// at once, or turns to three o'clock as an iOS wheel does, staying open.
jest.mock('./DueTimePicker', () => {
  const { createElement, Fragment } = require('react')
  const { Pressable, Text } = require('react-native')
  const button = (label: string, onPress: () => void) =>
    createElement(
      Pressable,
      { accessibilityRole: 'button', onPress },
      createElement(Text, null, label),
    )
  return {
    DueTimePicker: (props: {
      value: string | null
      onPick: (time: string | null, done: boolean) => void
    }) =>
      createElement(
        Fragment,
        null,
        button(`Pick 14:30, from ${props.value ?? 'none'}`, () => props.onPick('14:30', true)),
        button('Turn to 15:00', () => props.onPick('15:00', false)),
      ),
  }
})
jest.mock('./phoneZone', () => ({ phoneZone: () => 'Europe/Berlin' }))

const TODAY = '2026-10-10'
const styles = stylesFor(light)
const zoned: BoardTask = {
  id: 4,
  description: 'Join the stand-up',
  dueDate: '2026-10-11',
  dueTime: '10:00',
  timeZone: 'Asia/Tokyo',
  importance: 'LOW',
  state: 'TODO',
}

function form(props: Partial<Parameters<typeof TaskForm>[0]> = {}) {
  return (
    <TaskForm
      today={TODAY}
      language="en"
      messages={catalogues.en}
      styles={styles}
      theme={light}
      onSave={jest.fn().mockResolvedValue(true)}
      onCancel={jest.fn()}
      {...props}
    />
  )
}

/** Turns the zone switch; pressing a `Switch` does nothing in the test renderer. */
async function turnSwitch(on: boolean) {
  await fireEvent(screen.getByRole('switch', { name: 'Tied to a time zone' }), 'valueChange', on)
}

async function pickTime(user: ReturnType<typeof userEvent.setup>) {
  await user.press(screen.getByRole('button', { name: 'Add a time' }))
  await user.press(screen.getByRole('button', { name: /^Pick 14:30/ }))
}

describe("a task's due time in the form (#477)", () => {
  it('offers the zone switch only once there is a time, off by default', async () => {
    await render(form())
    const user = userEvent.setup()

    expect(screen.queryByRole('switch', { name: 'Tied to a time zone' })).not.toBeOnTheScreen()
    await pickTime(user)

    expect(screen.getByRole('button', { name: '14:30' })).toBeOnTheScreen()
    expect(screen.getByRole('switch', { name: 'Tied to a time zone' })).not.toBeChecked()
    expect(screen.queryByText('Time zone')).not.toBeOnTheScreen()
  })

  it("keeps iOS's wheels while they turn, until the time is pressed again", async () => {
    await render(form())
    const user = userEvent.setup()

    await user.press(screen.getByRole('button', { name: 'Add a time' }))
    await user.press(screen.getByRole('button', { name: 'Turn to 15:00' }))
    expect(screen.getByRole('button', { name: 'Turn to 15:00' })).toBeOnTheScreen()

    await user.press(screen.getByRole('button', { name: '15:00' }))
    expect(screen.queryByRole('button', { name: 'Turn to 15:00' })).not.toBeOnTheScreen()
  })

  it('puts the wheels away when the time is cleared', async () => {
    await render(form())
    const user = userEvent.setup()

    await user.press(screen.getByRole('button', { name: 'Add a time' }))
    await user.press(screen.getByRole('button', { name: 'Turn to 15:00' }))
    await user.press(screen.getByRole('button', { name: 'No time' }))

    expect(screen.queryByRole('button', { name: 'Turn to 15:00' })).not.toBeOnTheScreen()
  })

  it('finds a zone by the name people use, with spaces', async () => {
    await render(form({ task: zoned }))
    const user = userEvent.setup()

    await user.press(screen.getByRole('button', { name: 'Asia/Tokyo' }))
    await user.type(screen.getByLabelText('Search time zones'), 'ho chi')
    expect(screen.getByRole('button', { name: 'Asia/Ho Chi Minh' })).toBeOnTheScreen()
  })

  it('adds a floating time', async () => {
    const onSave = jest.fn().mockResolvedValue(true)
    await render(form({ onSave }))
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('What needs doing'), 'Take the pills')
    await pickTime(user)
    await user.press(screen.getByRole('button', { name: 'Add' }))

    expect(onSave).toHaveBeenCalledWith({
      description: 'Take the pills',
      dueDate: '2026-10-11',
      dueTime: '14:30',
      importance: 'MEDIUM',
      state: 'TODO',
    })
  })

  it("ties a time to the phone's zone, which can be changed", async () => {
    const onSave = jest.fn().mockResolvedValue(true)
    await render(form({ onSave }))
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('What needs doing'), 'Call the office')
    await pickTime(user)
    await turnSwitch(true)
    await user.press(screen.getByRole('button', { name: 'Europe/Berlin' }))
    await user.type(screen.getByLabelText('Search time zones'), 'tokyo')
    await user.press(screen.getByRole('button', { name: 'Asia/Tokyo' }))
    await user.press(screen.getByRole('button', { name: 'Add' }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ dueTime: '14:30', timeZone: 'Asia/Tokyo' }),
    )
  })

  it('drops the zone with the time', async () => {
    const onSave = jest.fn().mockResolvedValue(true)
    await render(form({ onSave }))
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('What needs doing'), 'Changed my mind')
    await pickTime(user)
    await turnSwitch(true)
    await user.press(screen.getByRole('button', { name: 'No time' }))
    expect(screen.queryByRole('switch', { name: 'Tied to a time zone' })).not.toBeOnTheScreen()
    await user.press(screen.getByRole('button', { name: 'Add' }))

    expect(onSave).toHaveBeenCalledWith({
      description: 'Changed my mind', dueDate: '2026-10-11', importance: 'MEDIUM', state: 'TODO',
    })
  })

  it('starts an edit with the time and zone the task has', async () => {
    await render(form({ task: zoned }))

    expect(screen.getByRole('button', { name: '10:00' })).toBeOnTheScreen()
    expect(screen.getByRole('switch', { name: 'Tied to a time zone' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Asia/Tokyo' })).toBeOnTheScreen()
  })

  it('clears the time and zone with null, which the backend would keep (#497)', async () => {
    const onSave = jest.fn().mockResolvedValue(true)
    await render(form({ task: zoned, onSave }))
    const user = userEvent.setup()

    await user.press(screen.getByRole('button', { name: 'No time' }))
    await user.press(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dueTime: null, timeZone: null }))
  })

  it('makes a zoned time floating when the switch is turned off', async () => {
    const onSave = jest.fn().mockResolvedValue(true)
    await render(form({ task: zoned, onSave }))
    const user = userEvent.setup()

    await turnSwitch(false)
    await user.press(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ dueTime: '10:00', timeZone: null }),
    )
  })

  it('gives a task its own zone back when the switch goes off and on again', async () => {
    await render(form({ task: zoned }))

    await turnSwitch(false)
    await turnSwitch(true)

    expect(screen.getByRole('button', { name: 'Asia/Tokyo' })).toBeOnTheScreen()
  })

  it('leaves the time out of an edit that did not change it', async () => {
    const onSave = jest.fn().mockResolvedValue(true)
    await render(form({ task: zoned, onSave }))
    const user = userEvent.setup()

    await user.press(screen.getByRole('button', { name: 'High' }))
    await user.press(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledWith({
      description: 'Join the stand-up', dueDate: '2026-10-11', importance: 'HIGH', state: 'TODO',
    })
  })

  it('turns the switch from its words too, as the website does', async () => {
    const user = userEvent.setup()
    await render(form({ task: zoned }))

    // Hidden from screen readers, which hear the switch alone, so it is looked up as hidden.
    const words = () => screen.getByTestId('zone-switch-label', { includeHiddenElements: true })
    await user.press(words())
    expect(screen.getByRole('switch', { name: 'Tied to a time zone' })).not.toBeChecked()

    await user.press(words())
    expect(screen.getByRole('switch', { name: 'Tied to a time zone' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Asia/Tokyo' })).toBeOnTheScreen()
  })

  it("draws the switch in the website's colours, not the platform's", async () => {
    await render(form({ task: zoned }))

    const tied = screen.getByRole('switch', { name: 'Tied to a time zone' })
    expect(tied.props.thumbTintColor ?? tied.props.thumbColor).toBe(light.bg)
    expect(tied.props.onTintColor ?? tied.props.trackColor?.true).toBe(light.accent)
  })

  it('speaks German', async () => {
    await render(form({ task: zoned, language: 'de', messages: catalogues.de }))

    expect(screen.getByRole('switch', { name: 'An eine Zeitzone gebunden' })).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Keine Uhrzeit' })).toBeOnTheScreen()
  })
})
