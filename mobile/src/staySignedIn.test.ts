import { INACTIVITY_LIMIT_MS, type Session } from './session'
import { createSessionStore, currentSession, sessionFromTokens, type KeyValueStore, type Tokens } from './staySignedIn'

function tokenWith(payload: object) {
  return `h.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.s`
}

function memoryStore(): KeyValueStore & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => void values.set(key, value),
    deleteItemAsync: async (key) => void values.delete(key),
  }
}

const NOW = Date.UTC(2026, 9, 10, 12)
const HOUR = 3600 * 1000

const session: Session = {
  idToken: tokenWith({ exp: (NOW + HOUR) / 1000 }),
  refreshToken: 'refresh-1',
  expiresAt: NOW + HOUR,
  lastUsedAt: NOW,
}

describe('staying signed in', () => {
  it('makes a session of what the provider issued, timed by the ID token', () => {
    const tokens: Tokens = { idToken: session.idToken, refreshToken: 'refresh-1' }

    expect(sessionFromTokens(tokens, NOW)).toEqual(session)
  })

  it('cannot make a session without an ID token it can read', () => {
    expect(sessionFromTokens({ refreshToken: 'r' }, NOW)).toBeNull()
    expect(sessionFromTokens({ idToken: 'opaque' }, NOW)).toBeNull()
  })

  it('keeps each part of a session under its own key, so none outgrows what a keychain holds', async () => {
    const store = memoryStore()

    await createSessionStore(store).save(session)

    expect([...store.values.keys()].sort()).toEqual(['taskfest.idToken', 'taskfest.refreshToken', 'taskfest.times'])
    await expect(createSessionStore(store).load()).resolves.toEqual(session)
  })

  it('keeps a session without a refresh token', async () => {
    const store = memoryStore()
    const withoutRefresh = { ...session, refreshToken: null }

    await createSessionStore(store).save(withoutRefresh)

    await expect(createSessionStore(store).load()).resolves.toEqual(withoutRefresh)
  })

  it('forgets everything on clearing', async () => {
    const store = memoryStore()
    await createSessionStore(store).save(session)

    await createSessionStore(store).clear()

    expect(store.values.size).toBe(0)
    await expect(createSessionStore(store).load()).resolves.toBeNull()
  })

  it('hands back a stored session as used now', async () => {
    const sessions = createSessionStore(memoryStore())
    await sessions.save(session)

    const current = await currentSession(sessions, jest.fn(), NOW + 1000)

    expect(current?.lastUsedAt).toBe(NOW + 1000)
    await expect(sessions.load()).resolves.toMatchObject({ lastUsedAt: NOW + 1000 })
  })

  it('ends a session unused for more than thirty days', async () => {
    const sessions = createSessionStore(memoryStore())
    await sessions.save(session)

    await expect(currentSession(sessions, jest.fn(), NOW + INACTIVITY_LIMIT_MS + 1)).resolves.toBeNull()
    await expect(sessions.load()).resolves.toBeNull()
  })

  it('renews an ID token about to run out', async () => {
    const sessions = createSessionStore(memoryStore())
    await sessions.save(session)
    const later = NOW + HOUR
    const renewedToken = tokenWith({ exp: (later + HOUR) / 1000 })
    const refresh = jest.fn().mockResolvedValue({ idToken: renewedToken, refreshToken: 'refresh-2' })

    const current = await currentSession(sessions, refresh, later)

    expect(refresh).toHaveBeenCalledWith('refresh-1')
    expect(current).toEqual({ idToken: renewedToken, refreshToken: 'refresh-2', expiresAt: later + HOUR, lastUsedAt: later })
  })

  it('keeps the refresh token when the provider issues no new one', async () => {
    const sessions = createSessionStore(memoryStore())
    await sessions.save(session)
    const later = NOW + HOUR
    const refresh = jest.fn().mockResolvedValue({ idToken: tokenWith({ exp: (later + HOUR) / 1000 }) })

    await expect(currentSession(sessions, refresh, later)).resolves.toMatchObject({ refreshToken: 'refresh-1' })
  })

  it('ends the session when renewing fails or is impossible', async () => {
    const failing = createSessionStore(memoryStore())
    await failing.save(session)
    await expect(currentSession(failing, jest.fn().mockRejectedValue(new Error('revoked')), NOW + HOUR)).resolves.toBeNull()
    await expect(failing.load()).resolves.toBeNull()

    const withoutRefresh = createSessionStore(memoryStore())
    await withoutRefresh.save({ ...session, refreshToken: null })
    await expect(currentSession(withoutRefresh, jest.fn(), NOW + HOUR)).resolves.toBeNull()
  })

  it('has nothing when nobody signed in', async () => {
    await expect(currentSession(createSessionStore(memoryStore()), jest.fn(), NOW)).resolves.toBeNull()
  })
})
