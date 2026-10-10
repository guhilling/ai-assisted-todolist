import { ContractBreachError, RequestFailedError, SignedOutError, fetchCurrentUser, fetchTasks } from './api'

const BASE = 'https://taskfest.example'

function respond(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response)
}

const aTask = { id: 1, description: 'Water the plants', dueDate: '2026-10-10', importance: 'HIGH', state: 'TODO' }

describe('the backend, as the app asks it', () => {
  it('sends the ID token as a bearer token', async () => {
    const fetchImpl = respond(200, [aTask])

    await fetchTasks({ baseUrl: BASE, idToken: 'the-token' }, fetchImpl)

    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/api/tasks`, {
      headers: { Accept: 'application/json', Authorization: 'Bearer the-token' },
    })
  })

  it('hands back the tasks it was sent, once they match the schema', async () => {
    await expect(fetchTasks({ baseUrl: BASE, idToken: 't' }, respond(200, [aTask]))).resolves.toEqual([aTask])
  })

  it('refuses a task that does not match the schema', async () => {
    const broken = { ...aTask, importance: 'URGENT' }

    await expect(fetchTasks({ baseUrl: BASE, idToken: 't' }, respond(200, [broken]))).rejects.toBeInstanceOf(
      ContractBreachError,
    )
  })

  it('refuses a list that is not a list', async () => {
    await expect(fetchTasks({ baseUrl: BASE, idToken: 't' }, respond(200, aTask))).rejects.toBeInstanceOf(
      ContractBreachError,
    )
  })

  it('reads a 401 as signed out, so the app asks for a sign-in again', async () => {
    await expect(fetchTasks({ baseUrl: BASE, idToken: 't' }, respond(401, {}))).rejects.toBeInstanceOf(SignedOutError)
  })

  it('reports any other failure with its status', async () => {
    const failure = fetchTasks({ baseUrl: BASE, idToken: 't' }, respond(503, {}))

    await expect(failure).rejects.toBeInstanceOf(RequestFailedError)
    await expect(failure).rejects.toMatchObject({ status: 503 })
  })

  it('asks who is signed in', async () => {
    const me = { email: 'gunnar@example.com', name: 'Gunnar' }
    const fetchImpl = respond(200, me)

    await expect(fetchCurrentUser({ baseUrl: BASE, idToken: 't' }, fetchImpl)).resolves.toEqual(me)
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/api/auth/me`, expect.anything())
  })
})
