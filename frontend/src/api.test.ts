/**
 * Tests for the wire layer that cannot be driven through the UI.
 *
 * `frontend/CLAUDE.md` says to prefer driving the UI over calling these functions directly,
 * and this is the exception it allows for: the behaviour here is what happens when the
 * *backend* returns something impossible, which no amount of clicking can produce.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  deleteTask,
  fetchAuthProviders,
  fetchCurrentUser,
  fetchTasks,
  putTask,
  type Task,
} from './api'

const VALID: Task = {
  id: 7,
  description: 'Write the report',
  dueDate: '2026-12-31',
  importance: 'MEDIUM',
  state: 'TODO',
}

/** A task as a broken or hostile backend could describe it, past TypeScript's erased types. */
function withId(id: unknown): Task {
  return { ...VALID, id } as unknown as Task
}

describe('addressing a task', () => {
  it('sends the id in the path when it is a real one', async () => {
    const seen: string[] = []
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      seen.push(String(input))
      return Promise.resolve(new Response(JSON.stringify(VALID), { status: 200 }))
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await putTask(VALID)

    expect(seen).toEqual(['/api/tasks/7'])
  })

  it.each([
    ['a traversal attempt', '../../elsewhere'],
    ['an absolute URL', 'https://evil.example/steal'],
    ['a fractional id', 1.5],
    ['nothing at all', undefined],
    ['null', null],
  ])('refuses to build a URL from %s, and sends nothing', async (_case, id) => {
    // readJson casts the response to its type rather than checking it, so `id` is only a
    // number by assertion. SonarCloud flags this path as API traversal and is right that
    // nothing was checking; a request built from this would carry the session cookie.
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(putTask(withId(id))).rejects.toThrow(/could not be addressed/i)
    await expect(deleteTask(withId(id))).rejects.toThrow(/could not be addressed/i)

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('trusting a response', () => {
  /** Answers every request with one payload, so a test only has to describe what came back. */
  function backendReturning(value: unknown) {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify(value), { status: 200 })))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    return fetchMock
  }

  it('accepts a task the backend really could have sent', async () => {
    backendReturning([VALID])

    await expect(fetchTasks()).resolves.toEqual([VALID])
  })

  it.each([
    ['an id that is a traversal attempt', { ...VALID, id: '../../elsewhere' }],
    ['an id that is an absolute URL', { ...VALID, id: 'https://evil.example/steal' }],
    ['a fractional id', { ...VALID, id: 1.5 }],
    ['an integer id too large to be exact', { ...VALID, id: 1e21 }],
    ['no id at all', { description: 'x', dueDate: '2026-12-31', importance: 'LOW', state: 'TODO' }],
    ['a state the backend has no name for', { ...VALID, state: 'ALMOST' }],
    ['an importance that is not one', { ...VALID, importance: 'URGENT' }],
    ['a due date that is not a date', { ...VALID, dueDate: 'next tuesday' }],
    ['a due date that could never exist', { ...VALID, dueDate: '2026-13-45' }],
    ['a description that is not a string', { ...VALID, description: 42 }],
  ])('refuses a task with %s', async (_case, task) => {
    backendReturning([task])

    await expect(fetchTasks()).rejects.toThrow(/does not match/i)
  })

  it('refuses a task list that is not a list', async () => {
    backendReturning({ tasks: [VALID] })

    await expect(fetchTasks()).rejects.toThrow(/does not match/i)
  })

  it('refuses a description longer than the column that stores it', async () => {
    backendReturning([{ ...VALID, description: 'x'.repeat(256) }])

    await expect(fetchTasks()).rejects.toThrow(/does not match/i)
  })

  it('accepts a description of exactly the maximum length', async () => {
    const atTheLimit = { ...VALID, description: 'x'.repeat(255) }
    backendReturning([atTheLimit])

    await expect(fetchTasks()).resolves.toEqual([atTheLimit])
  })

  it('refuses an email that is not one', async () => {
    backendReturning({ email: 'not-an-email' })

    await expect(fetchCurrentUser()).rejects.toThrow(/does not match/i)
  })

  it('accepts a field the backend has added and this version knows nothing about', async () => {
    // Forwards compatibility is deliberate: the schemas do not forbid extra properties, so a
    // backend that starts sending a new field does not break a frontend deployed before it.
    backendReturning([{ ...VALID, createdAt: '2026-01-01T00:00:00Z' }])

    await expect(fetchTasks()).resolves.toEqual([VALID])
  })

  it('accepts a signed-in user whose provider supplied no name and no picture', async () => {
    backendReturning({ email: 'person@example.com' })

    await expect(fetchCurrentUser()).resolves.toEqual({
      email: 'person@example.com',
      name: null,
      pictureUrl: null,
    })
  })

  it('accepts a signed-in user whose name and picture are explicitly null', async () => {
    backendReturning({ email: 'person@example.com', name: null, pictureUrl: null })

    await expect(fetchCurrentUser()).resolves.toEqual({
      email: 'person@example.com',
      name: null,
      pictureUrl: null,
    })
  })

  it('refuses a signed-in user with no email, since the email is the identity', async () => {
    backendReturning({ name: 'Person Example' })

    await expect(fetchCurrentUser()).rejects.toThrow(/does not match/i)
  })

  it('refuses a provider list that does not describe providers', async () => {
    backendReturning({ enabled: true, providers: [{ id: 'google' }] })

    await expect(fetchAuthProviders()).rejects.toThrow(/does not match/i)
  })

  it('accepts a provider that is configured but unusable', async () => {
    const unusable = {
      enabled: true,
      providers: [{ id: 'keycloak', label: 'Keycloak', available: false, loginUrl: null, issuer: '' }],
    }
    backendReturning(unusable)

    await expect(fetchAuthProviders()).resolves.toEqual(unusable)
  })
})
