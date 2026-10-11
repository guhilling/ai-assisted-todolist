/**
 * How long the app waits for an answer over the network before it counts as no connection (#311):
 * a connection that hangs rather than drops would otherwise be waited on without end, and the board
 * would say it is loading instead of showing the kept one with "No connection".
 */
export const REQUEST_MS = 10_000

/** No answer came in time; whatever was asked is aborted. To the app, no connection. */
export class TimedOutError extends Error {
  constructor(ms: number) {
    super(`No answer within ${ms / 1000} s.`)
    this.name = 'TimedOutError'
  }
}

/**
 * The work's result, or a {@link TimedOutError} once `ms` are up -- never a wait without end.
 *
 * The work is handed a signal, aborted when the time is up, for a fetch to close its connection.
 * It is raced as well rather than left to the abort alone, which not every call takes and a fetch
 * may be slow to honour; the rejection comes first, so it is what the caller sees.
 */
export async function withinLimit<T>(work: (signal: AbortSignal) => Promise<T>, ms = REQUEST_MS): Promise<T> {
  const abort = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeUp = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimedOutError(ms))
      abort.abort()
    }, ms)
  })
  try {
    return await Promise.race([work(abort.signal), timeUp])
  } finally {
    clearTimeout(timer)
  }
}
