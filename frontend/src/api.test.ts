/**
 * Tests for the wire layer that cannot be driven through the UI.
 *
 * `frontend/CLAUDE.md` says to prefer driving the UI over calling these functions directly,
 * and this is the exception it allows for: the behaviour here is what happens when the
 * *backend* returns something impossible, which no amount of clicking can produce.
 */
import { describe, expect, it, vi } from 'vitest'
import { deleteTask, putTask, type Task } from './api'

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
