import type { Session } from './session'
import { appSessionFrom, createSessionStore, currentSession } from './staySignedIn'
import { HOUR, memoryStore, tokenWith } from './testing'

// Noon, not the shared NOW.
const NOW = Date.UTC(2026, 9, 10, 12)
const DAY = 24 * HOUR

/** Ada's app session, traded at NOW and lasting the backend's thirty days. */
const session: Session = { token: 'taskfest_app_ada', expiresAt: NOW + 30 * DAY, email: 'ada@example.com' }

/** What a release before app sessions left in the keychain: an ID token, its refresh token and its times. */
function keptBefore() {
  const store = memoryStore()
  store.values.set('taskfest.idToken', tokenWith({ exp: (NOW + HOUR) / 1000, email: 'ada@example.com' }))
  store.values.set('taskfest.refreshToken', 'refresh-1')
  store.values.set('taskfest.times', JSON.stringify({ expiresAt: NOW + HOUR, lastUsedAt: NOW - DAY }))
  return store
}

describe('staying signed in', () => {
  it('makes a session of what the backend started, its address the ID token’s', () => {
    const idToken = tokenWith({ email: 'ada@example.com' })

    expect(appSessionFrom({ token: 'taskfest_app_ada', expiresAt: NOW + 30 * DAY }, idToken)).toEqual(session)
  })

  it('remembers that a session came from Google, across a restart', async () => {
    const google = appSessionFrom({ token: 'taskfest_app_ada', expiresAt: NOW + 30 * DAY }, 'opaque', 'google')
    const store = memoryStore()

    await createSessionStore(store).save(google)

    expect(google).toEqual({ token: 'taskfest_app_ada', expiresAt: NOW + 30 * DAY, via: 'google', email: null })
    await expect(createSessionStore(store).load()).resolves.toEqual(google)
  })

  it('is kept under a key of its own, in one value, with its address, which its token does not carry', async () => {
    const store = memoryStore()

    await createSessionStore(store).save(session)

    expect([...store.values.keys()]).toEqual(['taskfest.appSession'])
    await expect(createSessionStore(store).load()).resolves.toEqual(session)
  })

  it('leaves nothing of a session from before app sessions beside the one it keeps (#633)', async () => {
    const store = keptBefore()

    await createSessionStore(store).save(session)

    expect([...store.values.keys()]).toEqual(['taskfest.appSession'])
  })

  it('reads a session as the release that brought app sessions kept it', async () => {
    const store = memoryStore()
    store.values.set(
      'taskfest.appSession',
      JSON.stringify({ token: 'taskfest_app_ada', expiresAt: NOW + 30 * DAY, lastUsedAt: NOW, email: 'ada@example.com' }),
    )

    await expect(createSessionStore(store).load()).resolves.toEqual(session)
  })

  it('forgets everything on clearing', async () => {
    const store = memoryStore()
    await createSessionStore(store).save(session)

    await createSessionStore(store).clear()

    expect(store.values.size).toBe(0)
    await expect(createSessionStore(store).load()).resolves.toBeNull()
  })

  it('hands out an app session as it is, to its last day', async () => {
    const sessions = createSessionStore(memoryStore())
    await sessions.save(session)

    await expect(currentSession(sessions, NOW + 30 * DAY - 1)).resolves.toEqual(session)
  })

  it('forgets an app session that has ended, and hands out none', async () => {
    const store = memoryStore()
    const sessions = createSessionStore(store)
    await sessions.save(session)

    await expect(currentSession(sessions, NOW + 30 * DAY)).resolves.toBeNull()
    expect(store.values.size).toBe(0)
  })

  it('has nothing when nobody signed in', async () => {
    await expect(currentSession(createSessionStore(memoryStore()), NOW)).resolves.toBeNull()
  })

  it('takes a session from before app sessions for none, and leaves nothing of it in the keychain (#633)', async () => {
    const store = keptBefore()

    await expect(currentSession(createSessionStore(store), NOW)).resolves.toBeNull()
    expect(store.values.size).toBe(0)
  })
})
