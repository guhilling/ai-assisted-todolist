/**
 * What the app keeps between launches to stay signed in, and the rules for how long (#264, #267).
 *
 * Since #281 that is an **app session**: the backend's own, traded once for the provider's ID token
 * at sign-in, which ends 30 days after it, however much or little it is used; the app renews
 * nothing. A session kept from before is the provider's ID token itself, and the month it lasts is
 * the app's rule: it ends after thirty days without use, and every use starts the thirty days
 * again; until then, an ID token running out is renewed with the refresh token, a minute early so
 * no request goes out with one about to lapse. Such a session is traded for an app session as soon
 * as it can be, and that transition goes after one release (#633).
 */
export type Session = {
  /**
   * The token the backend is sent as a bearer token: the app session's, or, for a session kept
   * from before, the ID token. The name goes with the transition (#633).
   */
  idToken: string
  /** What renews the ID token, if the provider issued one. */
  refreshToken: string | null
  /** When the ID token runs out, in milliseconds since the epoch. */
  expiresAt: number
  /** When the session was last used, in milliseconds since the epoch. */
  lastUsedAt: number
  /**
   * Set when the session came from Google's sign-in (#280): Google gives the app no refresh token,
   * and its own SDK renews the ID token instead. Absent for the OpenID Connect providers.
   */
  via?: 'google'
  /**
   * Set for an app session (#281), which ends at `expiresAt` and is never renewed. Its token says
   * nothing about the account, so the address of the ID token it was traded for is kept beside it.
   */
  app?: { email: string | null }
  /**
   * Set on a session from before app sessions whose ID token was sent to be traded without a clear
   * answer (#634): the backend may have traded it, and would refuse it a second time, so it is
   * never sent to be traded again -- the session is renewed first, and the new one traded.
   */
  idTokenSpent?: true
}

/** How long a session lasts without being used: thirty days. */
export const INACTIVITY_LIMIT_MS = 30 * 24 * 60 * 60 * 1000

/** How long before its expiry an ID token is renewed. */
const RENEWAL_MARGIN_MS = 60 * 1000

/**
 * When a token runs out, from its `exp` claim.
 *
 * Not a verification: the backend checks the signature. The app only needs to know when to renew.
 *
 * @returns milliseconds since the epoch, or null when the token says nothing the app can read
 */
export function expiryOf(token: string): number | null {
  const exp = claimsOf(token)?.exp
  return typeof exp === 'number' ? exp * 1000 : null
}

/**
 * The signed-in address, from the ID token's `email` claim (#275): the same claim the backend
 * keys the account by, so it is what deleting the account asks to have typed.
 *
 * @returns the address, or null when the token names none the app can read
 */
export function emailOf(token: string): string | null {
  const email = claimsOf(token)?.email
  return typeof email === 'string' ? email : null
}

/**
 * Whom a token is about, from its `sub` claim: a renewal must come back for the same account, or
 * it is no renewal of this session (#280).
 */
export function subjectOf(token: string): string | null {
  const sub = claimsOf(token)?.sub
  return typeof sub === 'string' ? sub : null
}

/** A token's claims, unverified, or null when they cannot be read. They are UTF-8, which `atob` alone is not. */
function claimsOf(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1]
  if (!payload) {
    return null
  }
  try {
    const bytes = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const utf8 = Array.from(bytes, (byte) => `%${byte.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')
    return JSON.parse(decodeURIComponent(utf8)) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Whether the ID token should be renewed before it is sent. */
export function needsRefresh(session: Session, now: number) {
  return now >= session.expiresAt - RENEWAL_MARGIN_MS
}

/** Whether the session has gone unused for longer than it may. */
export function isInactive(session: Session, now: number) {
  return now - session.lastUsedAt > INACTIVITY_LIMIT_MS
}

/**
 * Whether the session is over: an app session at the end the backend gave it (#281), however
 * much it was used; one kept from before after thirty days without use.
 */
export function hasEnded(session: Session, now: number) {
  return session.app ? now >= session.expiresAt : isInactive(session, now)
}

/**
 * The address of the account a session signs in: kept beside an app session's token, which names
 * none (#281); read from the ID token of one kept from before.
 */
export function accountOf(session: Session): string | null {
  return session.app ? session.app.email : emailOf(session.idToken)
}

/** The session as it is after being used now. */
export function used(session: Session, now: number): Session {
  return { ...session, lastUsedAt: now }
}
