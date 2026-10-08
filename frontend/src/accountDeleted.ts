/**
 * The note that an account was just deleted (#213), carried across the sign-out.
 *
 * Deleting an account ends in a full-page navigation to the sign-out, which leaves the app and comes
 * back to the signed-out page; this is how that page knows to say what happened. Session storage,
 * so it never outlives the tab, and read once: the note is shown a single time. Storage can be
 * unavailable (a private window, blocked site data), in which case there is simply no note.
 */
const KEY = 'taskfest.accountDeleted'

/** Remembers, for the signed-out page, that the account was deleted. */
export function rememberAccountDeleted() {
  try {
    globalThis.sessionStorage?.setItem(KEY, 'true')
  } catch {
    // No note, then; the deletion itself has happened.
  }
}

/** Whether the account was just deleted, forgetting it at once so the note is shown only once. */
export function takeAccountDeleted() {
  try {
    const deleted = globalThis.sessionStorage?.getItem(KEY) === 'true'
    globalThis.sessionStorage?.removeItem(KEY)
    return deleted
  } catch {
    return false
  }
}
