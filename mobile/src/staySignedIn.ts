import { expiryOf, isInactive, needsRefresh, used, type Session } from './session'

/**
 * Keeping a sign-in on the phone, and handing out a session fit to send (#267).
 *
 * The tokens live in the platform's keychain (expo-secure-store), never in plain storage. Each
 * part has a key of its own: some iOS releases refused values above about 2 KB, and an ID token and
 * a refresh token together can be more than that.
 */

/** The part of expo-secure-store this needs, so tests can keep the session in memory instead. */
export type KeyValueStore = {
  getItemAsync(key: string): Promise<string | null>
  setItemAsync(key: string, value: string): Promise<void>
  deleteItemAsync(key: string): Promise<void>
}

/** What a provider hands out on sign-in or renewal. */
export type Tokens = { idToken?: string; refreshToken?: string }

/** Renews the tokens with a refresh token; rejects when the provider will not, or cannot be asked. */
export type Refresh = (refreshToken: string) => Promise<Tokens>

/**
 * The session could not be renewed for now -- no connection, the provider unreachable -- and is
 * kept: being offline for a moment must not undo a sign-in meant to last a month.
 */
export class RenewalUnavailableError extends Error {
  constructor(cause: unknown) {
    super('The sign-in could not be renewed just now.', { cause })
    this.name = 'RenewalUnavailableError'
  }
}

/** The OAuth error with which a provider refuses a refresh token for good: expired, revoked or unknown. */
const REFUSED = 'invalid_grant'

const ID_TOKEN = 'taskfest.idToken'
const REFRESH_TOKEN = 'taskfest.refreshToken'
const TIMES = 'taskfest.times'

/** A session made of tokens just issued, or null when there is no ID token to time it by. */
export function sessionFromTokens(tokens: Tokens, now: number, previous?: Session): Session | null {
  const expiresAt = tokens.idToken ? expiryOf(tokens.idToken) : null
  if (!tokens.idToken || expiresAt === null) {
    return null
  }
  return {
    idToken: tokens.idToken,
    // A provider may renew without issuing a new refresh token; the old one then stays good.
    refreshToken: tokens.refreshToken ?? previous?.refreshToken ?? null,
    expiresAt,
    lastUsedAt: now,
  }
}

/** Saves, loads and forgets the one session the app keeps. */
export function createSessionStore(store: KeyValueStore) {
  return {
    async save(session: Session) {
      await store.setItemAsync(ID_TOKEN, session.idToken)
      if (session.refreshToken) {
        await store.setItemAsync(REFRESH_TOKEN, session.refreshToken)
      } else {
        await store.deleteItemAsync(REFRESH_TOKEN)
      }
      await store.setItemAsync(TIMES, JSON.stringify({ expiresAt: session.expiresAt, lastUsedAt: session.lastUsedAt }))
    },

    async load(): Promise<Session | null> {
      const idToken = await store.getItemAsync(ID_TOKEN)
      const times = await store.getItemAsync(TIMES)
      if (!idToken || !times) {
        return null
      }
      const { expiresAt, lastUsedAt } = JSON.parse(times) as Pick<Session, 'expiresAt' | 'lastUsedAt'>
      return { idToken, refreshToken: await store.getItemAsync(REFRESH_TOKEN), expiresAt, lastUsedAt }
    },

    async clear() {
      await Promise.all([ID_TOKEN, REFRESH_TOKEN, TIMES].map((key) => store.deleteItemAsync(key)))
    },
  }
}

/** The session store the app uses. */
export type SessionStore = ReturnType<typeof createSessionStore>

/**
 * The session to send now, or null when the user has to sign in.
 *
 * Ends a session unused for thirty days, renews an ID token about to run out, and ends the
 * session when the provider refuses to renew it. When the provider cannot be asked, the session is
 * kept and a {@link RenewalUnavailableError} says so. Every session handed out is recorded as used
 * now.
 */
export async function currentSession(sessions: SessionStore, refresh: Refresh, now: number): Promise<Session | null> {
  let session = await sessions.load()
  if (session && isInactive(session, now)) {
    session = null
  }
  if (session && needsRefresh(session, now)) {
    session = await renewed(session, refresh, now)
  }
  if (!session) {
    await sessions.clear()
    return null
  }
  const current = used(session, now)
  await sessions.save(current)
  return current
}

async function renewed(session: Session, refresh: Refresh, now: number): Promise<Session | null> {
  if (!session.refreshToken) {
    return null
  }
  let tokens: Tokens
  try {
    tokens = await refresh(session.refreshToken)
  } catch (failure) {
    if ((failure as { code?: unknown }).code === REFUSED) {
      return null
    }
    throw new RenewalUnavailableError(failure)
  }
  return sessionFromTokens(tokens, now, session)
}
