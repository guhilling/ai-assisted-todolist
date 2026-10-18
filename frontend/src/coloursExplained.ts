/**
 * Whether the board's colours were explained in this browser already (#335): the colour legend
 * shows until dismissed once. Per browser is enough for a first-use hint, so nothing goes to the
 * server.
 */

/** Where the dismissal is remembered: per browser, which is enough for a first-use hint. */
const STORAGE_KEY = 'taskfest.coloursExplained'

/** Whether the colours were explained in this browser already; storage may be unavailable, which is no error. */
export function coloursExplained(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === 'yes'
  } catch {
    return false
  }
}

/** Remembers that they were, if storage allows. */
export function rememberColoursExplained() {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, 'yes')
  } catch {
    // A hint shown once more is no harm.
  }
}
