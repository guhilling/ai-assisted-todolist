import Constants from 'expo-constants'
import { File, Paths } from 'expo-file-system'
import { getLocales } from 'expo-localization'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { createTask, deleteAccount, deleteTask, fetchMinimumAppVersion, fetchTasks, restoreTask, updateTask } from './api'
import { createKeptBoardStore } from './keptBoard'
import { createReminderScheduler, type NotificationsApi } from './notifications'
import { providerFor } from './provider'
import { createSessionStore } from './staySignedIn'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import type { Variant } from './variants'
import { catalogues, chooseLanguage } from './web'

/** The variant this build was made as: `app.config.ts` put it into the app's configuration. */
const variant = Constants.expoConfig?.extra?.variant as Variant

/** No provider at all, for a variant without sign-in: nothing to sign in with or renew. */
const noProvider: Dependencies['provider'] = {
  signIn: async () => null,
  refresh: () => Promise.reject(new Error('This build has no sign-in.')),
}

/**
 * This build's release, from `TASKFEST_VERSION` through app.config.ts. The release build sets it
 * from the tag (#276); every other build, and every build until then, is 0.0.0.
 */
const appVersion = Constants.expoConfig?.version ?? '0.0.0'

/** The phone's language, chosen once: the app and the reminders' channel speak it. */
const language = chooseLanguage(null, getLocales().map((locale) => locale.languageTag))

// A reminder arriving while the app is open is shown as it would be outside it.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

/**
 * expo-notifications, adapted to what the reminders need. Written out rather than cast, so the
 * compiler checks every call against the library's own types after an SDK update.
 */
const notifications: NotificationsApi = {
  getPermissionsAsync: () => Notifications.getPermissionsAsync(),
  requestPermissionsAsync: () => Notifications.requestPermissionsAsync(),
  cancelAllScheduledNotificationsAsync: () => Notifications.cancelAllScheduledNotificationsAsync(),
  scheduleNotificationAsync: ({ content, trigger }) =>
    Notifications.scheduleNotificationAsync({
      content,
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: trigger.date, channelId: trigger.channelId },
    }),
  createChannel: async (id, name) => {
    await Notifications.setNotificationChannelAsync(id, { name, importance: Notifications.AndroidImportance.DEFAULT })
  },
}

const dependencies: Dependencies = {
  sessions: createSessionStore(SecureStore),
  provider: variant.signIn ? providerFor(variant.signIn, variant.scheme) : noProvider,
  // Every request names the app's release (#268).
  fetchTasks: (caller) => fetchTasks({ ...caller, appVersion }),
  changes: {
    create: (caller, input) => createTask({ ...caller, appVersion }, input),
    update: (caller, task) => updateTask({ ...caller, appVersion }, task),
    remove: (caller, task) => deleteTask({ ...caller, appVersion }, task),
    restore: (caller, task, today) => restoreTask({ ...caller, appVersion }, task, today),
  },
  deleteAccount: (caller) => deleteAccount({ ...caller, appVersion }),
  keptBoard: createKeptBoardStore(new File(Paths.cache, 'board.json')),
  reminders: createReminderScheduler(
    notifications,
    new File(Paths.document, 'reminders-declined'),
    catalogues[language].reminders.channel,
  ),
  fetchMinimumAppVersion: () => fetchMinimumAppVersion(variant.apiBaseUrl, appVersion),
  appVersion,
  now: Date.now,
}

/**
 * The app's root, with the real keychain, provider and backend.
 *
 * One screen, so no router: Expo Router, tried first, took the sign-in's return link for a page
 * and mounted a second copy of the app while the first still waited for its tokens (#267).
 * Navigation comes back with the screens that need it.
 */
export default function Main() {
  return <TaskFestApp variant={variant} language={language} dependencies={dependencies} />
}
