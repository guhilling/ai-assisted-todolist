import { ContractBreachError, RequestFailedError, SignedOutError, fetchMinimumAppVersion, fetchTasks } from './api'

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
      headers: expect.objectContaining({ Accept: 'application/json', Authorization: 'Bearer the-token' }),
    })
  })

  it('names the app’s release on every request, so the backend can tell who still calls what', async () => {
    const fetchImpl = respond(200, [aTask])

    await fetchTasks({ baseUrl: BASE, idToken: 't', appVersion: '1.4.0' }, fetchImpl)

    expect(fetchImpl.mock.calls[0][1].headers['X-TaskFest-App']).toBe('1.4.0')
  })

  it('hands back the tasks it was sent, once they match the schema', async () => {
    await expect(fetchTasks({ baseUrl: BASE, idToken: 't' }, respond(200, [aTask]))).resolves.toEqual([aTask])
  })

  it('refuses a task that does not match the schema', async () => {
    const broken = { ...aTask, description: undefined }

    await expect(fetchTasks({ baseUrl: BASE, idToken: 't' }, respond(200, [broken]))).rejects.toBeInstanceOf(
      ContractBreachError,
    )
  })

  it('takes a task with an importance or state it does not know, as unknown (#268)', async () => {
    // A newer backend may add one; an installed app is older than its backend.
    const newer = { ...aTask, importance: 'URGENT', state: 'BLOCKED' }

    const [task] = await fetchTasks({ baseUrl: BASE, idToken: 't' }, respond(200, [newer]))

    // Ordered as the least important and kept open, so it is never hidden; marked as unknown.
    expect(task).toMatchObject({ id: 1, importance: 'LOW', state: 'TODO', unknown: ['importance', 'state'] })
  })

  it('still refuses an unknown value where something else is wrong too', async () => {
    const broken = { ...aTask, importance: 'URGENT', id: 'one' }

    await expect(fetchTasks({ baseUrl: BASE, idToken: 't' }, respond(200, [broken]))).rejects.toBeInstanceOf(
      ContractBreachError,
    )
  })

  it('asks which app releases the backend still serves, without a sign-in', async () => {
    const fetchImpl = respond(200, { version: '1.3.0', minimumAppVersion: '1.1.0' })

    await expect(fetchMinimumAppVersion(BASE, '1.2.0', fetchImpl)).resolves.toBe('1.1.0')
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/api/version`, {
      headers: { Accept: 'application/json', 'X-TaskFest-App': '1.2.0' },
    })
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

})
