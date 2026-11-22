import type { AppSession } from './api'
import { emailOf, hasEnded, type Session } from './session'

/**
 * Keeping a sign-in on the phone, and handing out the session to send (#267).
 *
 * The app session (#281) lives in the platform's keychain (expo-secure-store), never in plain
 * storage, whole under one key and in one write.
 */

/** The part of expo-secure-store this needs, so tests can keep the session in memory instead. */
export type KeyValueStore = {
  getItemAsync(key: string): Promise<string | null>
  setItemAsync(key: string, value: string): Promise<void>
  deleteItemAsync(key: string): Promise<void>
}

/** What a provider hands out on sign-in: the one token the app uses. */
export type Tokens = { idToken?: string }

/**
 * Trades a provider's ID token for an app session (#281); rejects with a `SignedOutError` when the
 * backend refuses it, and otherwise when it cannot be asked.
 */
export type Trade = (idToken: string) => Promise<AppSession>

const APP_SESSION = 'taskfest.appSession'

/**
 * Where releases before app sessions kept the provider's tokens. Nothing reads them any more, and
 * they go whenever the session does (#633): an app updated from such a release starts with none.
 */
const BEFORE_APP_SESSIONS = ['taskfest.idToken', 'taskfest.refreshToken', 'taskfest.times']

/** Saves, loads and forgets the one session the app keeps. */
export function createSessionStore(store: KeyValueStore) {
  return {
    async save(session: Session) {
      await store.setItemAsync(APP_SESSION, JSON.stringify(session))
    },

    async load(): Promise<Session | null> {
      const kept = await store.getItemAsync(APP_SESSION)
      if (!kept) {
        return null
      }
      const { token, expiresAt, via, email } = JSON.parse(kept) as Session
      return { token, expiresAt, ...(via ? { via } : {}), email }
    },

    async clear() {
      await Promise.all([APP_SESSION, ...BEFORE_APP_SESSIONS].map((key) => store.deleteItemAsync(key)))
    },
  }
}

/** The session store the app uses. */
export type SessionStore = ReturnType<typeof createSessionStore>

/** The session to send now, or null when the user has to sign in: none is kept, or it has ended. */
export async function currentSession(sessions: SessionStore, now: number): Promise<Session | null> {
  const session = await sessions.load()
  if (!session || hasEnded(session, now)) {
    await sessions.clear()
    return null
  }
  return session
}

/**
 * The session to keep for the app session an ID token was traded for (#281): its end is the
 * backend's, and the address is the ID token's, since the session's own token names none.
 */
export function appSessionFrom(started: AppSession, idToken: string, via?: 'google'): Session {
  return { token: started.token, expiresAt: started.expiresAt, ...(via ? { via } : {}), email: emailOf(idToken) }
}
