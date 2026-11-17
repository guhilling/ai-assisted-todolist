import { SignedOutError } from './api'
import { accountOf, hasEnded, type Session } from './session'
import { RenewalUnavailableError, createSessionStore, currentSession, type Trade } from './staySignedIn'
import { HOUR, memoryStore, tokenWith } from './testing'

// Noon, not the shared NOW, as staySignedIn.test.ts has it.
const NOW = Date.UTC(2026, 9, 10, 12)
const DAY = 24 * HOUR

/** Ada's app session, traded at NOW and lasting the backend's thirty days. */
const appSession: Session = {
  idToken: 'taskfest_app_ada',
  refreshToken: null,
  expiresAt: NOW + 30 * DAY,
  lastUsedAt: NOW,
  app: { email: 'ada@example.com' },
}

/** Ada's session from before app sessions: an ID token good for an hour, and its refresh token. */
const idTokenSession: Session = {
  idToken: tokenWith({ exp: (NOW + HOUR) / 1000, email: 'ada@example.com' }),
  refreshToken: 'refresh-1',
  expiresAt: NOW + HOUR,
  lastUsedAt: NOW - DAY,
}

function trading(token = 'taskfest_app_ada', expiresAt = NOW + 30 * DAY): jest.MockedFunction<Trade> {
  return jest.fn().mockResolvedValue({ token, expiresAt })
}

describe('app sessions on the phone (#281)', () => {
  it('keeps an app session with its address, which its token does not carry', async () => {
    const store = memoryStore()

    await createSessionStore(store).save(appSession)

    await expect(createSessionStore(store).load()).resolves.toEqual(appSession)
    expect(store.values.has('taskfest.refreshToken')).toBe(false)
  })

  it('ends an app session when the backend’s thirty days are over, however much it was used', () => {
    expect(hasEnded({ ...appSession, lastUsedAt: NOW - 29 * DAY }, NOW)).toBe(false)
    expect(hasEnded(appSession, NOW + 30 * DAY - 1)).toBe(false)
    expect(hasEnded(appSession, NOW + 30 * DAY)).toBe(true)
  })

  it('still ends a session from before after thirty days without use', () => {
    expect(hasEnded(idTokenSession, NOW + 29 * DAY)).toBe(false)
    expect(hasEnded(idTokenSession, NOW + 30 * DAY)).toBe(true)
  })

  it('names the account by the address kept beside the token, or the ID token’s own', () => {
    expect(accountOf(appSession)).toBe('ada@example.com')
    expect(accountOf({ ...appSession, app: { email: null } })).toBeNull()
    expect(accountOf(idTokenSession)).toBe('ada@example.com')
  })

  it('hands out an app session as it is, without renewing or trading it', async () => {
    const sessions = createSessionStore(memoryStore())
    await sessions.save(appSession)
    const refresh = jest.fn()
    const trade = trading()

    const current = await currentSession(sessions, refresh, NOW + 29 * DAY, undefined, trade)

    expect(current).toMatchObject({ idToken: 'taskfest_app_ada', expiresAt: NOW + 30 * DAY, app: { email: 'ada@example.com' } })
    expect(refresh).not.toHaveBeenCalled()
    expect(trade).not.toHaveBeenCalled()
  })

  it('forgets an app session that has ended, and hands out none', async () => {
    const store = memoryStore()
    const sessions = createSessionStore(store)
    await sessions.save(appSession)

    await expect(currentSession(sessions, jest.fn(), NOW + 30 * DAY, undefined, trading())).resolves.toBeNull()
    expect(store.values.size).toBe(0)
  })

  it('trades a session from before for an app session, silently, and keeps that instead', async () => {
    const sessions = createSessionStore(memoryStore())
    await sessions.save({ ...idTokenSession, via: 'google' })
    const trade = trading()

    const current = await currentSession(sessions, jest.fn(), NOW, jest.fn(), trade)

    const traded: Session = { ...appSession, via: 'google' }
    expect(trade).toHaveBeenCalledWith(idTokenSession.idToken)
    expect(current).toEqual(traded)
    await expect(sessions.load()).resolves.toEqual(traded)
  })

  it('renews a session from before first when its ID token is about to run out, and trades the new one', async () => {
    const sessions = createSessionStore(memoryStore())
    await sessions.save({ ...idTokenSession, expiresAt: NOW })
    const fresh = tokenWith({ exp: (NOW + HOUR) / 1000, email: 'ada@example.com' })
    const refresh = jest.fn().mockResolvedValue({ idToken: fresh })
    const trade = trading()

    const current = await currentSession(sessions, refresh, NOW, undefined, trade)

    expect(refresh).toHaveBeenCalledWith('refresh-1')
    expect(trade).toHaveBeenCalledWith(fresh)
    expect(current).toEqual(appSession)
  })

  it('ends a session from before that the backend refuses to trade', async () => {
    const store = memoryStore()
    const sessions = createSessionStore(store)
    await sessions.save(idTokenSession)
    const trade = jest.fn().mockRejectedValue(new SignedOutError())

    await expect(currentSession(sessions, jest.fn(), NOW, undefined, trade)).resolves.toBeNull()
    expect(store.values.size).toBe(0)
  })

  it('goes on with a session from before that cannot be traded just now, and trades it next time', async () => {
    const sessions = createSessionStore(memoryStore())
    await sessions.save(idTokenSession)
    const trade = jest.fn().mockRejectedValueOnce(new TypeError('Network request failed'))
    trade.mockResolvedValueOnce({ token: 'taskfest_app_ada', expiresAt: NOW + 30 * DAY })

    await expect(currentSession(sessions, jest.fn(), NOW, undefined, trade)).resolves.toEqual({ ...idTokenSession, lastUsedAt: NOW })
    await expect(currentSession(sessions, jest.fn(), NOW, undefined, trade)).resolves.toEqual(appSession)
  })

  it('keeps a session from before when it cannot be renewed just now, without trying to trade it', async () => {
    const sessions = createSessionStore(memoryStore())
    await sessions.save({ ...idTokenSession, expiresAt: NOW })
    const trade = trading()
    const refresh = jest.fn().mockRejectedValue(new TypeError('Network request failed'))

    await expect(currentSession(sessions, refresh, NOW, undefined, trade)).rejects.toBeInstanceOf(RenewalUnavailableError)
    expect(trade).not.toHaveBeenCalled()
    await expect(sessions.load()).resolves.toEqual({ ...idTokenSession, expiresAt: NOW })
  })
})
