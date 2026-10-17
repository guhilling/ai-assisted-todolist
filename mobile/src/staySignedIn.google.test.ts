import type { Session } from './session'
import { RenewalUnavailableError, createSessionStore, currentSession, sessionFromTokens, type KeyValueStore } from './staySignedIn'

function tokenWith(payload: object) {
  return `h.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.s`
}

function memoryStore(): KeyValueStore {
  const values = new Map<string, string>()
  return {
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => void values.set(key, value),
    deleteItemAsync: async (key) => void values.delete(key),
  }
}

const NOW = Date.UTC(2026, 9, 17, 12)
const HOUR = 3600 * 1000

/** Google hands the app no refresh token: its own SDK renews the sign-in (#280). */
const google: Session = {
  idToken: tokenWith({ exp: (NOW + HOUR) / 1000 }),
  refreshToken: null,
  expiresAt: NOW + HOUR,
  lastUsedAt: NOW,
  via: 'google',
}

describe('staying signed in with Google', () => {
  it('remembers that a session came from Google, across a restart', async () => {
    const sessions = createSessionStore(memoryStore())
    await sessions.save(google)

    await expect(sessions.load()).resolves.toEqual(google)
  })

  it('keeps that through a renewal', () => {
    const renewed = sessionFromTokens({ idToken: tokenWith({ exp: (NOW + 2 * HOUR) / 1000 }) }, NOW + HOUR, google)

    expect(renewed?.via).toBe('google')
  })

  it('renews a Google session with Google, not with a refresh token', async () => {
    const sessions = createSessionStore(memoryStore())
    await sessions.save(google)
    const fresh = tokenWith({ exp: (NOW + 2 * HOUR) / 1000 })
    const refresh = jest.fn()
    const renewGoogle = jest.fn().mockResolvedValue({ idToken: fresh })

    const current = await currentSession(sessions, refresh, NOW + HOUR, renewGoogle)

    expect(current).toEqual({ idToken: fresh, refreshToken: null, expiresAt: NOW + 2 * HOUR, lastUsedAt: NOW + HOUR, via: 'google' })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('ends the session when Google refuses, and keeps it when Google cannot be asked', async () => {
    const refused = createSessionStore(memoryStore())
    await refused.save(google)
    const refusal = Object.assign(new Error('no signed-in account'), { code: 'invalid_grant' })
    await expect(currentSession(refused, jest.fn(), NOW + HOUR, jest.fn().mockRejectedValue(refusal))).resolves.toBeNull()

    const offline = createSessionStore(memoryStore())
    await offline.save(google)
    await expect(
      currentSession(offline, jest.fn(), NOW + HOUR, jest.fn().mockRejectedValue(new Error('offline'))),
    ).rejects.toBeInstanceOf(RenewalUnavailableError)
    await expect(offline.load()).resolves.toEqual(google)
  })

  it('ends a Google session that nothing can renew', async () => {
    const sessions = createSessionStore(memoryStore())
    await sessions.save(google)

    await expect(currentSession(sessions, jest.fn(), NOW + HOUR)).resolves.toBeNull()
  })

  it('ends the session when the renewal comes back for someone else', async () => {
    const sessions = createSessionStore(memoryStore())
    await sessions.save({ ...google, idToken: tokenWith({ exp: (NOW + HOUR) / 1000, sub: 'ada' }) })
    const someoneElse = tokenWith({ exp: (NOW + 2 * HOUR) / 1000, sub: 'bob' })

    await expect(
      currentSession(sessions, jest.fn(), NOW + HOUR, jest.fn().mockResolvedValue({ idToken: someoneElse })),
    ).resolves.toBeNull()
    await expect(sessions.load()).resolves.toBeNull()
  })
})

