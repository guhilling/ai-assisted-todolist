import { RequestFailedError, SignedOutError, TimedOutError } from './api'
import type { Session } from './session'
import { TRADE_RETRY_MS, createSessionStore, currentSession, type Trading } from './staySignedIn'
import { HOUR, memoryStore, tokenWith } from './testing'

// Noon, as staySignedIn.test.ts has it.
const NOW = Date.UTC(2026, 9, 10, 12)
const DAY = 24 * HOUR
const MINUTE = 60 * 1000

/** Ada's app session, traded at NOW. */
const appSession: Session = {
  idToken: 'taskfest_app_ada',
  refreshToken: null,
  expiresAt: NOW + 30 * DAY,
  lastUsedAt: NOW,
  app: { email: 'ada@example.com' },
}

/** Ada's session from before app sessions, its ID token good for an hour. */
const before: Session = {
  idToken: tokenWith({ exp: (NOW + HOUR) / 1000, email: 'ada@example.com' }),
  refreshToken: 'refresh-1',
  expiresAt: NOW + HOUR,
  lastUsedAt: NOW - DAY,
}

const fresh = tokenWith({ exp: (NOW + 2 * HOUR) / 1000, email: 'ada@example.com', n: 2 })

function trading(...answers: (Error | null)[]): Trading & { trade: jest.Mock } {
  const trade = jest.fn()
  for (const answer of answers) {
    if (answer) {
      trade.mockRejectedValueOnce(answer)
    } else {
      trade.mockResolvedValueOnce({ token: 'taskfest_app_ada', expiresAt: NOW + 30 * DAY })
    }
  }
  return { trade }
}

describe('an app session kept on the phone (#281, review of #634)', () => {
  it('is kept under a key of its own, in one value, so no half of it can be read as an ID token', async () => {
    const store = memoryStore()

    await createSessionStore(store).save(appSession)

    expect([...store.values.keys()]).toEqual(['taskfest.appSession'])
    await expect(createSessionStore(store).load()).resolves.toEqual(appSession)
  })

  it('is read before the session it replaced, should the app end before that was forgotten', async () => {
    const store = memoryStore()
    await createSessionStore(store).save(before)
    store.values.set('taskfest.appSession', JSON.stringify({ token: 'taskfest_app_ada', expiresAt: NOW + 30 * DAY, lastUsedAt: NOW, email: 'ada@example.com' }))

    await expect(createSessionStore(store).load()).resolves.toEqual(appSession)
  })

  it('replaces the session from before, whose keys go once it is kept', async () => {
    const store = memoryStore()
    const sessions = createSessionStore(store)
    await sessions.save(before)

    await sessions.save(appSession)

    expect([...store.values.keys()]).toEqual(['taskfest.appSession'])
  })

  it('goes on clearing', async () => {
    const store = memoryStore()
    await createSessionStore(store).save(appSession)

    await createSessionStore(store).clear()

    expect(store.values.size).toBe(0)
  })
})

describe('trading a session from before again (#281, review of #634)', () => {
  it('never sends an ID token again that went unanswered: it is renewed first, and the new one traded', async () => {
    const sessions = createSessionStore(memoryStore())
    await sessions.save(before)
    const trades = trading(new TimedOutError(10_000), null)
    const refresh = jest.fn().mockResolvedValue({ idToken: fresh })

    await expect(currentSession(sessions, refresh, NOW, undefined, trades)).resolves.toMatchObject({ idToken: before.idToken })
    await expect(currentSession(sessions, refresh, NOW + TRADE_RETRY_MS, undefined, trades)).resolves.toMatchObject({
      idToken: 'taskfest_app_ada',
      app: { email: 'ada@example.com' },
    })

    expect(trades.trade.mock.calls).toEqual([[before.idToken], [fresh]])
    expect(refresh).toHaveBeenCalledWith('refresh-1')
  })

  it('renews a Google session through Google before trading again', async () => {
    const sessions = createSessionStore(memoryStore())
    await sessions.save({ ...before, refreshToken: null, via: 'google' })
    const trades = trading(new RequestFailedError(500), null)
    const renewGoogle = jest.fn().mockResolvedValue({ idToken: fresh })

    await currentSession(sessions, jest.fn(), NOW, renewGoogle, trades)
    await currentSession(sessions, jest.fn(), NOW + TRADE_RETRY_MS, renewGoogle, trades)

    expect(trades.trade.mock.calls).toEqual([[before.idToken], [fresh]])
  })

  it('keeps that knowledge on the phone, for the next launch', async () => {
    const store = memoryStore()
    await createSessionStore(store).save(before)
    await currentSession(createSessionStore(store), jest.fn(), NOW, undefined, trading(new TypeError('Network request failed')))

    const nextLaunch = trading(null)
    const refresh = jest.fn().mockResolvedValue({ idToken: fresh })
    await currentSession(createSessionStore(store), refresh, NOW + MINUTE, undefined, nextLaunch)

    expect(nextLaunch.trade).toHaveBeenCalledWith(fresh)
  })

  it('does not trade again a session that cannot be renewed, and goes on with it as it is', async () => {
    const sessions = createSessionStore(memoryStore())
    await sessions.save({ ...before, refreshToken: null })
    const trades = trading(new TimedOutError(10_000))

    await currentSession(sessions, jest.fn(), NOW, undefined, trades)
    const current = await currentSession(sessions, jest.fn(), NOW + TRADE_RETRY_MS, undefined, trades)

    expect(trades.trade).toHaveBeenCalledTimes(1)
    expect(current).toMatchObject({ idToken: before.idToken })
  })

  it('does not trade again an ID token that a renewal hands back unchanged', async () => {
    const sessions = createSessionStore(memoryStore())
    await sessions.save(before)
    const trades = trading(new TimedOutError(10_000))
    const refresh = jest.fn().mockResolvedValue({ idToken: before.idToken })

    await currentSession(sessions, refresh, NOW, undefined, trades)
    await currentSession(sessions, refresh, NOW + TRADE_RETRY_MS, undefined, trades)

    expect(trades.trade).toHaveBeenCalledTimes(1)
  })

  it('trades the same ID token again after a clear answer that it was not traded, as a backend from before gives', async () => {
    const sessions = createSessionStore(memoryStore())
    await sessions.save(before)
    const trades = trading(new RequestFailedError(404), null)
    const refresh = jest.fn()

    await currentSession(sessions, refresh, NOW, undefined, trades)
    await currentSession(sessions, refresh, NOW + TRADE_RETRY_MS, undefined, trades)

    expect(trades.trade.mock.calls).toEqual([[before.idToken], [before.idToken]])
    expect(refresh).not.toHaveBeenCalled()
  })

  it('waits a few minutes after a failed trade before it tries again, rather than before every request', async () => {
    const sessions = createSessionStore(memoryStore())
    await sessions.save(before)
    const trades = trading(new RequestFailedError(404), null)

    await currentSession(sessions, jest.fn(), NOW, undefined, trades)
    await currentSession(sessions, jest.fn(), NOW + TRADE_RETRY_MS - 1, undefined, trades)
    expect(trades.trade).toHaveBeenCalledTimes(1)

    await currentSession(sessions, jest.fn(), NOW + TRADE_RETRY_MS, undefined, trades)
    expect(trades.trade).toHaveBeenCalledTimes(2)
  })

  it('waits a few minutes after a renewal to trade with that cannot be made, rather than renewing before every request', async () => {
    const sessions = createSessionStore(memoryStore())
    await sessions.save({ ...before, idTokenSpent: true })
    const trades = trading(null)
    const refresh = jest.fn().mockRejectedValueOnce(new TypeError('Network request failed')).mockResolvedValue({ idToken: fresh })

    await currentSession(sessions, refresh, NOW, undefined, trades)
    await currentSession(sessions, refresh, NOW + TRADE_RETRY_MS - 1, undefined, trades)
    expect(refresh).toHaveBeenCalledTimes(1)

    await currentSession(sessions, refresh, NOW + TRADE_RETRY_MS, undefined, trades)
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(trades.trade).toHaveBeenCalledWith(fresh)
  })

  it('waits a few minutes too after a renewal that hands back the spent ID token', async () => {
    const sessions = createSessionStore(memoryStore())
    await sessions.save({ ...before, idTokenSpent: true })
    const refresh = jest.fn().mockResolvedValue({ idToken: before.idToken })

    const trades = trading()
    await currentSession(sessions, refresh, NOW, undefined, trades)
    await currentSession(sessions, refresh, NOW + TRADE_RETRY_MS - 1, undefined, trades)

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(trades.trade).not.toHaveBeenCalled()
  })

  it('says the session was refused when the backend refuses the trade, after forgetting it', async () => {
    const store = memoryStore()
    await createSessionStore(store).save(before)

    await expect(currentSession(createSessionStore(store), jest.fn(), NOW, undefined, trading(new SignedOutError()))).rejects.toBeInstanceOf(
      SignedOutError,
    )
    expect(store.values.size).toBe(0)
  })
})
