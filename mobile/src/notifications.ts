import type { TextFile } from './keptBoard'
import { isoOf, timeOf } from './pickedDates'
import type { Reminder } from './reminders'

/**
 * What the reminders need of the platform: expo-notifications' calls, narrowed to the reminders'
 * use and adapted to it in `Main.tsx`, where the compiler checks them against the library -- and
 * tests stand in for it here.
 */
export type NotificationsApi = {
  getPermissionsAsync(): Promise<{ granted: boolean; canAskAgain: boolean }>
  requestPermissionsAsync(): Promise<{ granted: boolean }>
  cancelAllScheduledNotificationsAsync(): Promise<void>
  /** One notification at a moment, on an Android channel. */
  scheduleNotificationAsync(request: {
    content: { title: string; data?: { wallClock: string } }
    trigger: { date: Date; channelId: string }
  }): Promise<string>
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
  /**
   * Whether the app's offer to turn them on was answered -- "Not now", or "Turn on" and the
   * platform's question -- after which it is not made again.
   */
  answered(): Promise<boolean>
  /** "Not now". */
  decline(): Promise<void>
}

/**
 * What the offer of exact alarms needs of the platform (#665): expo-notifications' calls, adapted
 * in `Main.tsx` like `NotificationsApi`, and on Android only. Granted there before Android 14,
 * unless taken back.
 */
export type ExactAlarmsApi = {
  getExactAlarmPermissionsAsync(): Promise<{ granted: boolean; canAskAgain: boolean }>
  /** Opens the system's setting, and resolves once the user is back. */
  requestExactAlarmPermissionsAsync(): Promise<unknown>
}

/**
 * The offer to bring the reminders on time (#665): without exact alarms, which Android 14 and later
 * leave off until the user allows them, Android may bring a reminder up to an hour late. Made once,
 * like the reminders' own offer.
 */
export type ExactAlarmOffer = {
  /** Whether to make it: exact alarms not allowed, the setting there to allow them, not answered. */
  wanted(): Promise<boolean>
  /**
   * "Open settings": answered, then the system's setting, until the user is back. Whatever was
   * chosen there, the return to the foreground schedules the reminders anew (`Main.tsx`).
   */
  allow(): Promise<void>
  /** "Not now". */
  decline(): Promise<void>
}

/** A day and a time on the phone's calendar, without a time zone. */
export type WallClock = { year: number; month: number; day: number; hour: number; minute: number }

/**
 * A floating reminder's wall-clock time, for iOS's calendar trigger (#517). Without a time zone it
 * follows the phone: "pills at 08:00" comes at the new zone's 08:00 after a flight, without the app
 * being opened. None for a zoned reminder, whose moment is the same everywhere, nor for a time the
 * phone's clock skips -- 02:30 on the day the clocks go forward, which `at` has moved on -- since a
 * calendar trigger for a time that never comes might never fire.
 *
 * @param at the moment the reminder was worked out for, on the phone's clock
 * @param wallClock its wall-clock time, `YYYY-MM-DDTHH:mm`, when it floats
 */
export function calendarOf(at: Date, wallClock: string | undefined): WallClock | undefined {
  if (!wallClock || `${isoOf(at)}T${timeOf(at)}` !== wallClock) {
    return undefined
  }
  const [year, month, day, hour, minute] = wallClock.split(/[-T:]/).map(Number)
  return { year, month, day, hour, minute }
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
 * already scheduled does nothing -- most changes to a board leave them as they were -- until
 * `forget` is called: on Android, exact alarms allowed meanwhile apply only to reminders scheduled
 * after that (#665).
 *
 * @param answeredFlag a file whose existence records that the offer was answered
 * @param channelName the Android channel's name, in the user's language
 */
export function createReminderScheduler(
  api: NotificationsApi,
  answeredFlag: TextFile,
  channelName: string,
): ReminderScheduler & { forget(): void } {
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
          // A floating reminder's wall-clock time goes along, for Android's receiver to move it by
          // when the time zone changes (#479; mobile/plugins/android/TimeZoneChangedReceiver.kt).
          content: reminder.wallClock
            ? { title: reminder.title, data: { wallClock: reminder.wallClock } }
            : { title: reminder.title },
          trigger: { date: reminder.at, channelId: CHANNEL },
        }),
      ),
    )
    scheduled = wanted
  }

  return {
    async permission() {
      // By whether it may be asked, not by expo's status: on Android 13 and later notifications are
      // off until allowed, so expo reports "denied" before anyone was asked. A first refusal there
      // still allows asking again -- which the answered flag, not this, keeps the app from doing.
      const { granted, canAskAgain } = await api.getPermissionsAsync()
      return granted ? 'granted' : canAskAgain ? 'undetermined' : 'denied'
    },

    async ask() {
      await api.createChannel(CHANNEL, channelName)
      // Answered once asked, whatever the answer: the app does not ask a second time.
      await keepAnswered(answeredFlag, 'The answered offer could not be kept')
      return (await api.requestPermissionsAsync()).granted
    },

    replace(reminders) {
      const run = queue.then(() => replaceNow(reminders))
      queue = run.catch(() => undefined)
      return run
    },

    async answered() {
      return answeredFlag.exists
    },

    async decline() {
      await answeredFlag.write('declined')
    },

    // After the replacement on its way, which would otherwise count its reminders as scheduled.
    forget() {
      queue = queue.then(() => {
        scheduled = null
      })
    },
  }
}

/**
 * Records that an offer was answered before the platform is asked. Not kept, the offer only comes
 * again, which is no reason to skip the platform's question now.
 */
async function keepAnswered(answeredFlag: TextFile, warning: string) {
  try {
    await answeredFlag.write('answered')
  } catch (failure) {
    console.warn(warning, failure)
  }
}

/**
 * The offer of exact alarms with expo-notifications (#665). Allowed, they apply to the reminders
 * scheduled after that, which the return to the foreground sees to (`Main.tsx`).
 *
 * @param answeredFlag a file whose existence records that the offer was answered
 */
export function createExactAlarmOffer(api: ExactAlarmsApi, answeredFlag: TextFile): ExactAlarmOffer {
  return {
    async wanted() {
      if (answeredFlag.exists) {
        return false
      }
      // canAskAgain is false only where the app does not declare the permission: no setting to open.
      const { granted, canAskAgain } = await api.getExactAlarmPermissionsAsync()
      return !granted && canAskAgain
    },

    async allow() {
      await keepAnswered(answeredFlag, 'The answered offer of exact alarms could not be kept')
      await api.requestExactAlarmPermissionsAsync()
    },

    async decline() {
      await answeredFlag.write('declined')
    },
  }
}
