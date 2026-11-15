/**
 * Runs `work` on every item, at most `limit` at a time, and answers each outcome in the items'
 * order, as `Promise.allSettled` does -- a failure is reported in its place, and the rest go on.
 *
 * For what sends one request per task, such as clearing completed tasks or undoing their
 * deletion: all at once, a board of fifty sends fifty requests in one burst, and the API's
 * throttle answers whatever is beyond its burst of 20 with 429 (#607). A few at a time keeps the
 * board's own requests inside it, and they still overlap enough to be quick.
 */
export async function settledInTurn<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const outcomes: PromiseSettledResult<R>[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      try {
        outcomes[index] = { status: 'fulfilled', value: await work(items[index]) }
      } catch (reason) {
        outcomes[index] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return outcomes
}

/** How many of a board's own requests run at once (#607): well inside the API's burst of 20. */
export const REQUESTS_AT_ONCE = 4
