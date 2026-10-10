import type { TextFile } from './keptBoard'
import type { Reminder } from './reminders'

/** The part of expo-notifications the reminders need, so tests can stand in for the platform. */
export type NotificationsApi = {
  getPermissionsAsync(): Promise<{ granted: boolean; canAskAgain: boolean }>
  requestPermissionsAsync(): Promise<{ granted: boolean }>
  cancelAllScheduledNotificationsAsync(): Promise<void>
  scheduleNotificationAsync(request: {
    content: { title: string }
    trigger: { type: 'date'; date: Date; channelId: string }
  }): Promise<string>
  setNotificationChannelAsync(id: string, channel: { name: string; importance: number }): Promise<unknown>
}

/** Whether reminders may be shown: allowed, refused for good, or not asked yet. */
export type ReminderPermission = 'granted' | 'denied' | 'undetermined'

/** Schedules the due-day reminders on the phone, and asks for the permission they need (#273). */
export type ReminderScheduler = {
  permission(): Promise<ReminderPermission>
  /** Asks the platform; true when the user allowed them. */
  ask(): Promise<boolean>
  /** Replaces every reminder scheduled with these -- none, to clear them. */
  replace(reminders: Reminder[]): Promise<void>
  /** Whether the app's offer to turn them on was declined ("Not now"), which is not asked again. */
  declined(): Promise<boolean>
  decline(): Promise<void>
}

/** Android's channel for them: what its settings list them as, and switch them off by. */
const CHANNEL = 'reminders'

/**
 * The reminders with expo-notifications: local notifications, scheduled for a moment -- 08:00 on
 * the day, as the phone's clock had it when scheduled -- and replaced whole each time, so one never
 * outlives the task it was for. Android needs a channel before it can ask or show one; iOS ignores
 * the channel. Without permission nothing is scheduled, and the app works on regardless.
 *
 * @param declinedFlag a file whose existence records that the offer was declined
 * @param channel Android's channel: its name in the user's language, and expo-notifications'
 *   `AndroidImportance` for it
 */
export function createReminderScheduler(
  api: NotificationsApi,
  declinedFlag: TextFile,
  channel: { name: string; importance: number },
): ReminderScheduler {
  const ensureChannel = () => api.setNotificationChannelAsync(CHANNEL, channel)

  return {
    async permission() {
      const { granted, canAskAgain } = await api.getPermissionsAsync()
      return granted ? 'granted' : canAskAgain ? 'undetermined' : 'denied'
    },

    async ask() {
      await ensureChannel()
      return (await api.requestPermissionsAsync()).granted
    },

    async replace(reminders) {
      await api.cancelAllScheduledNotificationsAsync()
      if (reminders.length === 0 || !(await api.getPermissionsAsync()).granted) {
        return
      }
      await ensureChannel()
      for (const reminder of reminders) {
        await api.scheduleNotificationAsync({
          content: { title: reminder.title },
          trigger: { type: 'date', date: reminder.at, channelId: CHANNEL },
        })
      }
    },

    async declined() {
      return declinedFlag.exists
    },

    async decline() {
      declinedFlag.write('declined')
    },
  }
}
