/**
 * How the board orders its tasks (#217): by due date, within a day by importance, high first, then
 * by creation. Tested directly, like dates.ts, because it is pure and a reversed comparison hides
 * easily behind a board that happens to arrive sorted.
 */
import { describe, expect, it } from 'vitest'
import { compareCompleted, compareOpen, importanceLevels } from './importance'
import type { Task } from './api'

function task(id: number, dueDate: string, importance: Task['importance']): Task {
  return { id, description: `#${id}`, dueDate, importance, state: 'TODO' }
}

const ids = (tasks: Task[]) => tasks.map((each) => each.id)

describe('the order of open tasks', () => {
  it('puts the earlier due date first, whatever the importance', () => {
    const sorted = [task(1, '2026-10-12', 'HIGH'), task(2, '2026-10-11', 'LOW')].sort(compareOpen)
    expect(ids(sorted)).toEqual([2, 1])
  })

  it('puts high before medium before low within a day', () => {
    const sorted = [task(1, '2026-10-11', 'LOW'), task(2, '2026-10-11', 'HIGH'), task(3, '2026-10-11', 'MEDIUM')]
      .sort(compareOpen)
    expect(ids(sorted)).toEqual([2, 3, 1])
  })

  it('keeps creation order among tasks otherwise alike', () => {
    const sorted = [task(9, '2026-10-11', 'MEDIUM'), task(4, '2026-10-11', 'MEDIUM')].sort(compareOpen)
    expect(ids(sorted)).toEqual([4, 9])
  })

  it('does not follow the order the pickers offer the levels in', () => {
    // The picker lists least important first; the board ranks most important first.
    expect(importanceLevels).toEqual(['LOW', 'MEDIUM', 'HIGH'])
    const sorted = [task(1, '2026-10-11', 'LOW'), task(2, '2026-10-11', 'HIGH')].sort(compareOpen)
    expect(ids(sorted)).toEqual([2, 1])
  })
})

describe('the order of completed tasks', () => {
  it('puts the most recently due first, and within a day ranks like open tasks', () => {
    const sorted = [
      task(1, '2026-10-01', 'HIGH'),
      task(2, '2026-10-05', 'LOW'),
      task(3, '2026-10-05', 'HIGH'),
    ].sort(compareCompleted)
    expect(ids(sorted)).toEqual([3, 2, 1])
  })
})
