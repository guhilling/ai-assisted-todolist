/**
 * What the app keeps between launches to stay signed in, and the rules for how long (#264, #267).
 *
 * The backend sees only ID tokens, which live an hour: there is nothing on the server to expire.
 * So the month a sign-in lasts is the app's rule, kept here. A session ends after thirty days
 * without use, and every use starts the thirty days again. Until then, an ID token running out is
 * renewed with the refresh token, a minute early so no request goes out with one about to lapse.
 */
export type Session = {
  /** The ID token the backend is sent as a bearer token. */
  idToken: string
  /** What renews the ID token, if the provider issued one. */
  refreshToken: string | null
  /** When the ID token runs out, in milliseconds since the epoch. */
  expiresAt: number
  /** When the session was last used, in milliseconds since the epoch. */
  lastUsedAt: number
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
  const payload = token.split('.')[1]
  if (!payload) {
    return null
  }
  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown }
    return typeof claims.exp === 'number' ? claims.exp * 1000 : null
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

/** The session as it is after being used now. */
export function used(session: Session, now: number): Session {
  return { ...session, lastUsedAt: now }
}
