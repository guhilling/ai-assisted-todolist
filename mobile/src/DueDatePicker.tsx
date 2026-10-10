import DateTimePicker from '@react-native-community/datetimepicker'
import { Platform } from 'react-native'
import { dateOf, isoOf } from './pickedDates'

/**
 * The platform's own date picker (#271): a dialog on Android, a calendar in the form on iOS.
 *
 * It hands back the chosen day, or null when the dialog was dismissed, once per pick -- the form
 * then hides it again.
 */
export function DueDatePicker({
  value,
  minimum,
  onPick,
}: {
  value: string
  /** The earliest day to offer: today for a new task, which the backend refuses in the past. */
  minimum?: string
  onPick: (iso: string | null) => void
}) {
  return (
    <DateTimePicker
      mode="date"
      value={dateOf(value)}
      minimumDate={minimum ? dateOf(minimum) : undefined}
      display={Platform.OS === 'ios' ? 'inline' : 'default'}
      onChange={(event, date) => onPick(event.type === 'set' && date ? isoOf(date) : null)}
    />
  )
}
