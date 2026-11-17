import { RequestFailedError, SignedOutError, type AppSession } from './api'
import { emailOf, expiryOf, hasEnded, needsRefresh, subjectOf, used, type Session } from './session'

/**
 * Keeping a sign-in on the phone, and handing out a session fit to send (#267).
 *
 * The tokens live in the platform's keychain (expo-secure-store), never in plain storage. A
 * session from before app sessions keeps each part under a key of its own: some iOS releases
 * refused values above about 2 KB, and an ID token and a refresh token together can be more than
 * that. An app session (#281) is small, and is kept whole under a key of its own, in one write: no
 * half of it can ever be read as the other kind.
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
 * Renews a Google sign-in through Google's SDK (#280), which keeps what it needs itself; rejects
 * with the code `invalid_grant` when Google will not, as a provider refusing a refresh token does.
 */
export type RenewGoogle = () => Promise<Tokens>

/**
 * Trades a provider's ID token for an app session (#281); rejects with a `SignedOutError` when the
 * backend refuses it, and otherwise when it cannot be asked.
 */
export type Trade = (idToken: string) => Promise<AppSession>

/**
 * How long the app waits after a trade that failed without a refusal before it tries again (#634):
 * a few minutes, rather than a request held up before every call the app makes while offline, or
 * while its backend is older than app sessions.
 */
export const TRADE_RETRY_MS = 5 * 60 * 1000

/**
 * Trading sessions kept from before for app sessions (#281), and when the last trade failed: kept
 * for the app's run, in memory, as `currentSession` notes it.
 */
export type Trading = { trade: Trade; failedAt?: number }

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
const APP_SESSION = 'taskfest.appSession'

/** An app session as it is kept, whole, under its key. */
type KeptAppSession = { token: string; expiresAt: number; lastUsedAt: number; via?: 'google'; email: string | null }

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
    ...(previous?.via ? { via: previous.via } : {}),
  }
}

/** Saves, loads and forgets the one session the app keeps. */
export function createSessionStore(store: KeyValueStore) {
  return {
    async save(session: Session) {
      if (session.app) {
        const kept: KeptAppSession = {
          token: session.idToken,
          expiresAt: session.expiresAt,
          lastUsedAt: session.lastUsedAt,
          ...(session.via ? { via: session.via } : {}),
          email: session.app.email,
        }
        await store.setItemAsync(APP_SESSION, JSON.stringify(kept))
        // Only once it is kept: the app ending in between leaves the old session to be read after it.
        await Promise.all([ID_TOKEN, REFRESH_TOKEN, TIMES].map((key) => store.deleteItemAsync(key)))
        return
      }
      await store.setItemAsync(ID_TOKEN, session.idToken)
      if (session.refreshToken) {
        await store.setItemAsync(REFRESH_TOKEN, session.refreshToken)
      } else {
        await store.deleteItemAsync(REFRESH_TOKEN)
      }
      // Where the session came from travels with its times: the one small record kept beside the tokens.
      await store.setItemAsync(
        TIMES,
        JSON.stringify({
          expiresAt: session.expiresAt,
          lastUsedAt: session.lastUsedAt,
          via: session.via,
          spent: session.idTokenSpent,
        }),
      )
      await store.deleteItemAsync(APP_SESSION)
    },

    async load(): Promise<Session | null> {
      const app = await store.getItemAsync(APP_SESSION)
      if (app) {
        const { token, expiresAt, lastUsedAt, via, email } = JSON.parse(app) as KeptAppSession
        return { idToken: token, refreshToken: null, expiresAt, lastUsedAt, ...(via ? { via } : {}), app: { email } }
      }
      const idToken = await store.getItemAsync(ID_TOKEN)
      const times = await store.getItemAsync(TIMES)
      if (!idToken || !times) {
        return null
      }
      const { expiresAt, lastUsedAt, via, spent } = JSON.parse(times) as Pick<Session, 'expiresAt' | 'lastUsedAt' | 'via'> & {
        spent?: true
      }
      const session: Session = { idToken, refreshToken: await store.getItemAsync(REFRESH_TOKEN), expiresAt, lastUsedAt }
      return { ...session, ...(via ? { via } : {}), ...(spent ? { idTokenSpent: true as const } : {}) }
    },

    async clear() {
      await Promise.all([APP_SESSION, ID_TOKEN, REFRESH_TOKEN, TIMES].map((key) => store.deleteItemAsync(key)))
    },
  }
}

/** The session store the app uses. */
export type SessionStore = ReturnType<typeof createSessionStore>

/**
 * The session to send now, or null when the user has to sign in.
 *
 * An app session (#281) is handed out as it is until the end the backend gave it. One kept from
 * before ends unused for thirty days; its ID token is renewed when about to run out, and the
 * session ends when the provider refuses to renew it. When the provider cannot be asked, the
 * session is kept and a {@link RenewalUnavailableError} says so. A Google session is renewed with
 * `renewGoogle`, and ends when there is none to renew it.
 *
 * With `trading`, a session kept from before is then traded for an app session, silently, as
 * Gunnar decided, until #633 removes the transition. Refused, it is forgotten and a
 * `SignedOutError` says so. Not possible just now, it goes on as it is, and is tried again after
 * {@link TRADE_RETRY_MS}; an ID token sent without a clear answer may have been traded already, so
 * it is never sent again: the session is renewed first, and the new ID token traded, and one that
 * cannot be renewed is not traded at all. Every session handed out is recorded as used now.
 */
export async function currentSession(
  sessions: SessionStore,
  refresh: Refresh,
  now: number,
  renewGoogle?: RenewGoogle,
  trading?: Trading,
): Promise<Session | null> {
  const loaded = await sessions.load()
  let session = loaded && hasEnded(loaded, now) ? null : loaded
  if (session && !session.app) {
    const renew = renewalOf(session, refresh, renewGoogle)
    const tradeDue = trading && (trading.failedAt === undefined || now - trading.failedAt >= TRADE_RETRY_MS)
    if (needsRefresh(session, now)) {
      session = await renewed(session, renew, now)
    } else if (tradeDue && session.idTokenSpent && renew) {
      // Renewed only to trade: a renewal that cannot be made now leaves the session as it was.
      const spent = session
      session = await renewed(spent, renew, now).catch(() => spent)
    }
    // A renewal may hand back the ID token it already had, which stays as spent as it was.
    if (session && loaded?.idTokenSpent && session.idToken === loaded.idToken) {
      session = { ...session, idTokenSpent: true }
    }
    if (session && trading && tradeDue && !session.idTokenSpent) {
      try {
        session = await traded(session, trading, now)
      } catch (failure) {
        await sessions.clear()
        throw failure
      }
    }
  }
  if (!session) {
    await sessions.clear()
    return null
  }
  const current = used(session, now)
  await sessions.save(current)
  return current
}

/**
 * The app session an ID token was traded for, in place of the session it came from (#281): the
 * session's end is the backend's, and the address is the ID token's, since the token names none.
 */
export function appSessionFrom(started: AppSession, session: Session, now: number): Session {
  return {
    idToken: started.token,
    refreshToken: null,
    expiresAt: started.expiresAt,
    lastUsedAt: now,
    ...(session.via ? { via: session.via } : {}),
    app: { email: emailOf(session.idToken) },
  }
}

/**
 * The session whose trade failed without a refusal, marked when its ID token may have been traded
 * after all (#634): any failure but a clear answer that it was not -- a 4xx other than the refusal,
 * as from a backend from before app sessions. A timeout, no connection or a server error may
 * have come after the backend took it.
 */
export function afterFailedTrade(session: Session, failure: unknown): Session {
  const clearlyNotTraded = failure instanceof RequestFailedError && failure.status < 500
  return clearlyNotTraded ? session : { ...session, idTokenSpent: true }
}

/**
 * A session kept from before as the app session its ID token trades for. Refused, it is forgotten
 * by the caller and a `SignedOutError` says so; failed otherwise, it goes on as it is, the failure
 * noted for {@link TRADE_RETRY_MS}.
 */
async function traded(session: Session, trading: Trading, now: number): Promise<Session> {
  try {
    const started = await trading.trade(session.idToken)
    delete trading.failedAt
    return appSessionFrom(started, session, now)
  } catch (failure) {
    if (failure instanceof SignedOutError) {
      throw failure
    }
    trading.failedAt = now
    console.warn('The session could not be traded for an app session just now', failure)
    return afterFailedTrade(session, failure)
  }
}

/** What renews this session, or null when nothing can. */
function renewalOf(session: Session, refresh: Refresh, renewGoogle?: RenewGoogle): (() => Promise<Tokens>) | null {
  if (session.via === 'google') {
    return renewGoogle ?? null
  }
  const refreshToken = session.refreshToken
  return refreshToken ? () => refresh(refreshToken) : null
}

async function renewed(session: Session, renew: (() => Promise<Tokens>) | null, now: number): Promise<Session | null> {
  if (!renew) {
    return null
  }
  let tokens: Tokens
  try {
    tokens = await renew()
  } catch (failure) {
    if ((failure as { code?: unknown }).code === REFUSED) {
      return null
    }
    throw new RenewalUnavailableError(failure)
  }
  // Android's account sheet may come up during a renewal, and another account may be picked in it:
  // that is a sign-in of someone else, not this session going on.
  const before = subjectOf(session.idToken)
  const after = tokens.idToken ? subjectOf(tokens.idToken) : null
  if (before && after && before !== after) {
    return null
  }
  return sessionFromTokens(tokens, now, session)
}
