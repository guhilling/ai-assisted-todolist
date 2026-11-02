import DateTimePicker from '@react-native-community/datetimepicker'
import { Platform } from 'react-native'
import { timeOf } from './pickedDates'

/**
 * The platform's own time picker (#477): a dialog on Android, wheels in the form on iOS.
 *
 * It hands back the chosen time as `HH:mm`, or null when the dialog was dismissed, and whether the
 * pick is done. Android's dialog is done with one answer, and the form then hides it; iOS's wheels
 * answer as each one stops, so they stay until the form puts them away. It opens on the task's
 * time, or on 09:00 for a task without one.
 */
export function DueTimePicker({
  value,
  onPick,
}: {
  value: string | null
  onPick: (time: string | null, done: boolean) => void
}) {
  const [hours, minutes] = (value ?? '09:00').split(':').map(Number)
  const shown = new Date(2000, 0, 1, hours, minutes)
  return (
    <DateTimePicker
      mode="time"
      value={shown}
      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
      onChange={(event, date) =>
        onPick(event.type === 'set' && date ? timeOf(date) : null, Platform.OS !== 'ios')
      }
    />
  )
}
