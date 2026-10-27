import { ContractBreachError, RequestFailedError, addDraft, discardDraft, startDraft } from './api'

const BASE = 'https://taskfest.example'
const caller = { baseUrl: BASE, idToken: 'the-token', appVersion: '1.4.0' }

function respond(...answers: [number, unknown?][]) {
  const fetchImpl = jest.fn()
  for (const [status, body] of answers) {
    fetchImpl.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as Response)
  }
  return fetchImpl
}

const input = { description: 'Pay the bill', dueDate: '2026-10-19', importance: 'MEDIUM', state: 'TODO' } as const
const signedIn = {
  Accept: 'application/json',
  Authorization: 'Bearer the-token',
  'Content-Type': 'application/json',
  'X-TaskFest-App': '1.4.0',
}

describe('draft tasks, as the app asks the backend (#381)', () => {
  it('starts a draft and hands back its id', async () => {
    const fetchImpl = respond([201, { id: 77 }])

    await expect(startDraft(caller, fetchImpl)).resolves.toBe(77)
    // Nothing to send: no body, so no type of one.
    const { 'Content-Type': _none, ...bodiless } = signedIn
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/api/tasks/drafts`, expect.objectContaining({ method: 'POST', headers: bodiless }))
  })

  it('refuses a draft the backend describes otherwise than its schema', async () => {
    await expect(startDraft(caller, respond([201, { id: 'seven' }]))).rejects.toBeInstanceOf(ContractBreachError)
  })

  it('says a backend from before drafts by its status, for the app to carry on without', async () => {
    await expect(startDraft(caller, respond([404, {}]))).rejects.toEqual(new RequestFailedError(404))
  })

  it('adds a draft, and hands back the task as stored', async () => {
    const added = { id: 77, ...input, attachments: [] }
    const fetchImpl = respond([201, added])

    await expect(addDraft(caller, 77, input, fetchImpl)).resolves.toEqual(added)
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/api/tasks/drafts/77/add`, {
      method: 'POST',
      headers: signedIn,
      body: JSON.stringify(input),
      signal: expect.any(AbortSignal),
    })
  })

  it('discards a draft', async () => {
    const fetchImpl = respond([204])

    await discardDraft(caller, 77, fetchImpl)

    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/api/tasks/drafts/77`, expect.objectContaining({ method: 'DELETE' }))
  })
})
