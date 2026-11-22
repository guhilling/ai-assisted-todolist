/**
 * What the app keeps between launches to stay signed in, and the rule for how long (#264, #267).
 *
 * That is an **app session** (#281): the backend's own, traded once for the provider's ID token at
 * sign-in, which ends 30 days after it, however much or little it is used. The app renews nothing.
 */
export type Session = {
  /** The app session's token, which the backend is sent as a bearer token. */
  token: string
  /** When the session ends, in milliseconds since the epoch. */
  expiresAt: number
  /** Set when the session came from Google's sign-in (#280): signing out then signs out of Google too. */
  via?: 'google'
  /** The address of the ID token the session was traded for, since its own token names none. */
  email: string | null
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

/** Whether the session is over: at the end the backend gave it, however much it was used. */
export function hasEnded(session: Session, now: number) {
  return now >= session.expiresAt
}
