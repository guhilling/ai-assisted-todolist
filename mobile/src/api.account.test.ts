import { RequestFailedError, SignedOutError, deleteAccount } from './api'

const BASE = 'https://taskfest.example'
const caller = { baseUrl: BASE, idToken: 'the-token', appVersion: '1.4.0' }

function respond(status: number) {
  return jest.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status } as Response)
}

describe('deleting the account, as the app asks the backend (#275)', () => {
  it('deletes the signed-in user’s account, which answers with nothing to read', async () => {
    const fetchImpl = respond(204)

    await expect(deleteAccount(caller, fetchImpl)).resolves.toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/api/account`, {
      method: 'DELETE',
      headers: { Accept: 'application/json', Authorization: 'Bearer the-token', 'X-TaskFest-App': '1.4.0' },
    })
  })

  it('signs out when the backend no longer accepts the token, and says when it refused', async () => {
    await expect(deleteAccount(caller, respond(401))).rejects.toBeInstanceOf(SignedOutError)
    await expect(deleteAccount(caller, respond(500))).rejects.toEqual(new RequestFailedError(500))
  })
})
