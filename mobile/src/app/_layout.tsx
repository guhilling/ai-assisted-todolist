import Constants from 'expo-constants'
import { getLocales } from 'expo-localization'
import * as SecureStore from 'expo-secure-store'
import { fetchTasks } from '../api'
import { providerFor } from '../provider'
import { createSessionStore } from '../staySignedIn'
import { TaskFestApp, type Dependencies } from '../TaskFestApp'
import type { Variant } from '../variants'
import { chooseLanguage } from '../web'

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
 * The app, with the real keychain, provider and backend -- in the root layout rather than a route,
 * so no navigation can unmount it. The sign-in's return arrives as a link while the sign-in is
 * still waiting for it; were the app inside a route, that link would mount a fresh copy, which
 * found no session yet and showed the sign-in again (#267).
 */
export default function Layout() {
  const language = chooseLanguage(null, getLocales().map((locale) => locale.languageTag))
  return <TaskFestApp variant={variant} language={language} dependencies={dependencies} />
}
