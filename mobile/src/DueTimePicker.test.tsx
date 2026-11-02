import DateTimePicker from '@react-native-community/datetimepicker'
import { render } from '@testing-library/react-native'
import { DueTimePicker } from './DueTimePicker'

jest.mock('@react-native-community/datetimepicker', () => jest.fn(() => null))

const picker = DateTimePicker as unknown as jest.Mock

function shownWith() {
  return picker.mock.calls.at(-1)[0]
}

describe('the due time picker (#477)', () => {
  it("opens on the task's time, on the phone's own clock", async () => {
    await render(<DueTimePicker value="14:30" onPick={jest.fn()} />)

    expect(shownWith().mode).toBe('time')
    expect(shownWith().value.getHours()).toBe(14)
    expect(shownWith().value.getMinutes()).toBe(30)
  })

  it('opens on 09:00 for a task without a time', async () => {
    await render(<DueTimePicker value={null} onPick={jest.fn()} />)

    expect(shownWith().value.getHours()).toBe(9)
    expect(shownWith().value.getMinutes()).toBe(0)
  })

  it('hands back the chosen time, or nothing when dismissed', async () => {
    const onPick = jest.fn()
    await render(<DueTimePicker value={null} onPick={onPick} />)

    shownWith().onChange({ type: 'set' }, new Date(2000, 0, 1, 7, 5))
    shownWith().onChange({ type: 'dismissed' }, undefined)

    expect(onPick.mock.calls).toEqual([['07:05'], [null]])
  })
})
