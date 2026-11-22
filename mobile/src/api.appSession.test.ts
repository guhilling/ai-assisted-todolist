import { ContractBreachError, RequestFailedError, SignedOutError, endAppSession, startAppSession } from './api'

const BASE = 'https://taskfest.example'
/** A token as the backend makes them: the prefix and 43 characters of base64url. */
const TOKEN = `taskfest_app_${'q8Jx2mJ0bZ8tQ1n4Yc7d5v3s6K9wF2hL0aR1uE4oP7i'}`

function respond(status: number, body?: unknown) {
  return jest.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body } as Response)
}

describe('app sessions, as the app asks the backend for them (#281)', () => {
  it('trades the provider’s ID token for an app session, sent as the bearer token once', async () => {
    const fetchImpl = respond(201, { token: TOKEN, expiresAt: '2026-11-17T09:00:00Z' })

    await expect(startAppSession({ baseUrl: BASE, appVersion: '1.8.0' }, 'the-id-token', fetchImpl)).resolves.toEqual({
      token: TOKEN,
      expiresAt: Date.UTC(2026, 10, 17, 9),
    })
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/api/auth/app-session`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: 'Bearer the-id-token', 'X-TaskFest-App': '1.8.0' },
      signal: expect.any(AbortSignal),
    })
  })

  it('says when the backend refuses the ID token, and when it answers otherwise than agreed', async () => {
    await expect(startAppSession({ baseUrl: BASE }, 'id', respond(401))).rejects.toBeInstanceOf(SignedOutError)
    await expect(startAppSession({ baseUrl: BASE }, 'id', respond(404))).rejects.toEqual(new RequestFailedError(404))
    await expect(startAppSession({ baseUrl: BASE }, 'id', respond(201, { token: TOKEN }))).rejects.toBeInstanceOf(
      ContractBreachError,
    )
    await expect(
      startAppSession({ baseUrl: BASE }, 'id', respond(201, { token: TOKEN, expiresAt: 'soon' })),
    ).rejects.toBeInstanceOf(ContractBreachError)
  })

  it('ends the app session its token names, which answers with nothing to read', async () => {
    const fetchImpl = respond(204)

    await expect(endAppSession({ baseUrl: BASE, token: 'taskfest_app_abc', appVersion: '1.8.0' }, fetchImpl)).resolves.toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/api/auth/app-session`, {
      method: 'DELETE',
      headers: { Accept: 'application/json', Authorization: 'Bearer taskfest_app_abc', 'X-TaskFest-App': '1.8.0' },
      signal: expect.any(AbortSignal),
    })
  })
})
