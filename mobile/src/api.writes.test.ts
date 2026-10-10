import { ContractBreachError, RequestFailedError, SignedOutError, createTask, deleteTask, restoreTask, updateTask } from './api'

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

const aTask = { id: 7, description: 'Water the plants', dueDate: '2026-10-12', importance: 'HIGH', state: 'TODO' } as const
const signedIn = {
  Accept: 'application/json',
  Authorization: 'Bearer the-token',
  'Content-Type': 'application/json',
  'X-TaskFest-App': '1.4.0',
}

describe('changing tasks, as the app asks the backend (#271)', () => {
  it('creates a task and hands back what the backend stored', async () => {
    const fetchImpl = respond([201, aTask])
    const input = { description: 'Water the plants', dueDate: '2026-10-12', importance: 'HIGH', state: 'TODO' } as const

    await expect(createTask(caller, input, fetchImpl)).resolves.toEqual(aTask)
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/api/tasks`, {
      method: 'POST',
      headers: signedIn,
      body: JSON.stringify(input),
    })
  })

  it('saves the whole task, since the backend replaces rather than patches', async () => {
    const fetchImpl = respond([200, { ...aTask, state: 'DONE' }])

    await expect(updateTask(caller, { ...aTask, state: 'DONE' }, fetchImpl)).resolves.toEqual({ ...aTask, state: 'DONE' })
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/api/tasks/7`, {
      method: 'PUT',
      headers: signedIn,
      body: JSON.stringify({ description: 'Water the plants', dueDate: '2026-10-12', importance: 'HIGH', state: 'DONE' }),
    })
  })

  it('deletes a task, which answers with nothing to read', async () => {
    const fetchImpl = respond([204])

    await expect(deleteTask(caller, aTask, fetchImpl)).resolves.toBeUndefined()
    const { Accept, Authorization } = signedIn
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/api/tasks/7`, {
      method: 'DELETE',
      headers: { Accept, Authorization, 'X-TaskFest-App': '1.4.0' },
    })
  })

  it('signs out when the backend no longer accepts the token', async () => {
    await expect(deleteTask(caller, aTask, respond([401]))).rejects.toBeInstanceOf(SignedOutError)
    await expect(updateTask(caller, aTask, respond([401]))).rejects.toBeInstanceOf(SignedOutError)
  })

  it('says how the backend refused a change', async () => {
    await expect(createTask(caller, aTask, respond([400, {}]))).rejects.toEqual(new RequestFailedError(400))
    await expect(deleteTask(caller, aTask, respond([404]))).rejects.toEqual(new RequestFailedError(404))
  })

  it('refuses a stored task that does not match the schema', async () => {
    await expect(createTask(caller, aTask, respond([201, { ...aTask, id: 'seven' }]))).rejects.toBeInstanceOf(
      ContractBreachError,
    )
  })

  it('puts a deleted task back as it was, with its files', async () => {
    const deleted = { ...aTask, attachments: [{ id: 3 }, { id: 4 }] } as never
    const fetchImpl = respond([201, { ...aTask, id: 8 }])

    await expect(restoreTask(caller, deleted, '2026-10-10', fetchImpl)).resolves.toEqual({ ...aTask, id: 8 })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      description: 'Water the plants',
      dueDate: '2026-10-12',
      importance: 'HIGH',
      state: 'TODO',
      attachmentIds: [3, 4],
    })
  })

  it('puts back an overdue task by creating it today and then dating it back', async () => {
    const overdue = { ...aTask, dueDate: '2026-10-01' }
    const fetchImpl = respond([201, { ...overdue, id: 8, dueDate: '2026-10-10' }], [200, { ...overdue, id: 8 }])

    await expect(restoreTask(caller, overdue, '2026-10-10', fetchImpl)).resolves.toEqual({ ...overdue, id: 8 })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).dueDate).toBe('2026-10-10')
    expect(fetchImpl.mock.calls[1][0]).toBe(`${BASE}/api/tasks/8`)
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).dueDate).toBe('2026-10-01')
  })
})
