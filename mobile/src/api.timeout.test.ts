import { REQUEST_MS, TimedOutError, VERSION_CHECK_MS, createTask, fetchMinimumAppVersion, fetchTasks } from './api'

const BASE = 'https://taskfest.example'
const caller = { baseUrl: BASE, idToken: 't' }

/** A backend that takes the request and never answers. */
function silent() {
  return jest.fn((_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(() => undefined))
}

/** A backend that answers at once, but whose body never arrives. */
function stalled() {
  return jest.fn().mockResolvedValue({ ok: true, status: 200, json: () => new Promise(() => undefined) } as Response)
}

describe('a request that gets no answer (#311)', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('fails after ten seconds, which the board reads as no connection', async () => {
    const loading = fetchTasks(caller, silent())
    const failed = expect(loading).rejects.toBeInstanceOf(TimedOutError)

    jest.advanceTimersByTime(REQUEST_MS)

    await failed
    expect(REQUEST_MS).toBe(10_000)
  })

  it('is still waited on until the time is up', async () => {
    let settled = false
    const loading = fetchTasks(caller, silent()).finally(() => (settled = true))
    const failed = expect(loading).rejects.toBeInstanceOf(TimedOutError)

    await jest.advanceTimersByTimeAsync(REQUEST_MS - 1)
    expect(settled).toBe(false)

    await jest.advanceTimersByTimeAsync(1)
    await failed
  })

  it('is aborted, so its connection is not left open', async () => {
    const fetchImpl = silent()
    const loading = fetchTasks(caller, fetchImpl).catch(() => undefined)

    jest.advanceTimersByTime(REQUEST_MS)
    await loading

    expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })

  it('counts the answer’s body too', async () => {
    const loading = fetchTasks(caller, stalled())
    const failed = expect(loading).rejects.toBeInstanceOf(TimedOutError)

    await Promise.resolve()
    jest.advanceTimersByTime(REQUEST_MS)

    await failed
  })

  it('makes a change fail too, with the usual error', async () => {
    const adding = createTask(caller, { description: 'Water the plants', dueDate: '2026-10-12', importance: 'HIGH', state: 'TODO' }, silent())
    const failed = expect(adding).rejects.toBeInstanceOf(TimedOutError)

    jest.advanceTimersByTime(REQUEST_MS)

    await failed
  })

  it('fails with its own error even where the fetch gives up the moment it is aborted', async () => {
    const fetchImpl = jest.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
        ),
    )
    const loading = fetchTasks(caller, fetchImpl)
    const failed = expect(loading).rejects.toBeInstanceOf(TimedOutError)

    jest.advanceTimersByTime(REQUEST_MS)

    await failed
  })

  it('asks which releases the backend serves for three seconds only, as the start waits no longer', async () => {
    const fetchImpl = silent()
    const asking = fetchMinimumAppVersion(BASE, '1.2.0', fetchImpl)
    const failed = expect(asking).rejects.toBeInstanceOf(TimedOutError)

    jest.advanceTimersByTime(VERSION_CHECK_MS)

    await failed
    expect(VERSION_CHECK_MS).toBe(3000)
    expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })

  it('leaves no timer behind once answered in time', async () => {
    const aTask = { id: 1, description: 'Water the plants', dueDate: '2026-10-10', importance: 'HIGH', state: 'TODO' }
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve([aTask]) } as Response)

    await fetchTasks(caller, fetchImpl)

    expect(jest.getTimerCount()).toBe(0)
  })
})
