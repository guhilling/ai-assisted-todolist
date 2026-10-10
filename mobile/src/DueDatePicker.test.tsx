import DateTimePicker from '@react-native-community/datetimepicker'
import { render } from '@testing-library/react-native'
import { DueDatePicker } from './DueDatePicker'
import { dateOf, isoOf } from './pickedDates'

jest.mock('@react-native-community/datetimepicker', () => jest.fn(() => null))

const picker = DateTimePicker as unknown as jest.Mock

function shownWith() {
  return picker.mock.calls.at(-1)[0]
}

describe('the due date picker', () => {
  it('reads and writes a day on the phone’s own calendar, whatever its time zone', () => {
    expect(isoOf(dateOf('2026-03-29'))).toBe('2026-03-29')
    expect(dateOf('2026-10-10').getDate()).toBe(10)
  })

  it('opens on the task’s day, no earlier than the minimum', async () => {
    await render(<DueDatePicker value="2026-10-12" minimum="2026-10-10" onPick={jest.fn()} />)

    expect(isoOf(shownWith().value)).toBe('2026-10-12')
    expect(isoOf(shownWith().minimumDate)).toBe('2026-10-10')
  })

  it('offers any day when there is no minimum', async () => {
    await render(<DueDatePicker value="2026-10-12" onPick={jest.fn()} />)

    expect(shownWith().minimumDate).toBeUndefined()
  })

  it('hands back the chosen day, or nothing when dismissed', async () => {
    const onPick = jest.fn()
    await render(<DueDatePicker value="2026-10-12" onPick={onPick} />)

    shownWith().onChange({ type: 'set' }, dateOf('2026-11-02'))
    shownWith().onChange({ type: 'dismissed' }, undefined)

    expect(onPick.mock.calls).toEqual([['2026-11-02'], [null]])
  })
})
