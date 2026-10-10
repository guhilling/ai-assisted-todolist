import type { TextFile } from './keptBoard'
import type { Reminder } from './reminders'

/**
 * What the reminders need of the platform: expo-notifications' calls, narrowed to the reminders'
 * use and adapted to it in `Main.tsx`, where the compiler checks them against the library -- and
 * tests stand in for it here.
 */
export type NotificationsApi = {
  getPermissionsAsync(): Promise<{ granted: boolean; status: string }>
  requestPermissionsAsync(): Promise<{ granted: boolean }>
  cancelAllScheduledNotificationsAsync(): Promise<void>
  /** One notification at a moment, on an Android channel. */
  scheduleNotificationAsync(request: { content: { title: string }; trigger: { date: Date; channelId: string } }): Promise<string>
  /** Android's channel, which it needs before it can ask or show one; nothing on iOS. */
  createChannel(id: string, name: string): Promise<void>
}

/** Whether reminders may be shown: allowed, refused, or not asked yet. */
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
 * outlives the task it was for. Without permission nothing is scheduled, and the app works on
 * regardless.
 *
 * Replacements run one at a time: each cancels everything and then schedules, so two overlapping
 * would otherwise both leave their reminders behind. A replacement with exactly the reminders
 * already scheduled does nothing -- most changes to a board leave them as they were.
 *
 * @param declinedFlag a file whose existence records that the offer was declined
 * @param channelName the Android channel's name, in the user's language
 */
export function createReminderScheduler(api: NotificationsApi, declinedFlag: TextFile, channelName: string): ReminderScheduler {
  let queue: Promise<unknown> = Promise.resolve()
  /** What is scheduled now, as JSON; null when that is not known, or nothing could be. */
  let scheduled: string | null = null

  const replaceNow = async (reminders: Reminder[]) => {
    const wanted = JSON.stringify(reminders)
    const { granted } = await api.getPermissionsAsync()
    if (granted && wanted === scheduled) {
      return
    }
    scheduled = null
    await api.cancelAllScheduledNotificationsAsync()
    if (!granted || reminders.length === 0) {
      scheduled = granted ? wanted : null
      return
    }
    await api.createChannel(CHANNEL, channelName)
    await Promise.all(
      reminders.map((reminder) =>
        api.scheduleNotificationAsync({
          content: { title: reminder.title },
          trigger: { date: reminder.at, channelId: CHANNEL },
        }),
      ),
    )
    scheduled = wanted
  }

  return {
    async permission() {
      const { granted, status } = await api.getPermissionsAsync()
      // By the status, not by whether it may be asked again: Android asks twice, so a first refusal
      // still allows asking -- and it is a refusal all the same.
      return granted ? 'granted' : status === 'undetermined' ? 'undetermined' : 'denied'
    },

    async ask() {
      await api.createChannel(CHANNEL, channelName)
      return (await api.requestPermissionsAsync()).granted
    },

    replace(reminders) {
      const run = queue.then(() => replaceNow(reminders))
      queue = run.catch(() => undefined)
      return run
    },

    async declined() {
      return declinedFlag.exists
    },

    async decline() {
      declinedFlag.write('declined')
    },
  }
}
