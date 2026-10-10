import Constants from 'expo-constants'
import { getLocales } from 'expo-localization'
import * as SecureStore from 'expo-secure-store'
import { fetchTasks } from './api'
import { providerFor } from './provider'
import { createSessionStore } from './staySignedIn'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import type { Variant } from './variants'
import { chooseLanguage } from './web'

/** The variant this build was made as: `app.config.ts` put it into the app's configuration. */
const variant = Constants.expoConfig?.extra?.variant as Variant

/** No provider at all, for a variant without sign-in: nothing to sign in with or renew. */
const noProvider: Dependencies['provider'] = {
  signIn: async () => null,
  refresh: () => Promise.reject(new Error('This build has no sign-in.')),
}

const dependencies: Dependencies = {
  sessions: createSessionStore(SecureStore),
  provider: variant.signIn ? providerFor(variant.signIn, variant.scheme) : noProvider,
  fetchTasks: (caller) => fetchTasks(caller),
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
  const language = chooseLanguage(null, getLocales().map((locale) => locale.languageTag))
  return <TaskFestApp variant={variant} language={language} dependencies={dependencies} />
}
