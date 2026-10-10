import { boardOf } from './board'
import type { Task } from './web'

const TODAY = '2026-10-10'

function task(id: number, dueDate: string, overrides: Partial<Task> = {}): Task {
  return { id, description: `Task ${id}`, dueDate, importance: 'MEDIUM', state: 'TODO', ...overrides }
}

describe('the board', () => {
  it('puts open tasks in the website’s sections, in the website’s order', () => {
    const board = boardOf(
      [
        task(1, '2026-10-30'),
        task(2, '2026-10-09'),
        task(3, '2026-10-10'),
        task(4, '2026-10-11'),
        task(5, '2026-10-13'),
      ],
      TODAY,
    )

    expect(board.sections.map((section) => [section.bucket, section.tasks.map((t) => t.id)])).toEqual([
      ['overdue', [2]],
      ['today', [3]],
      ['tomorrow', [4]],
      ['thisWeek', [5]],
      ['later', [1]],
    ])
  })

  it('leaves out sections with nothing in them', () => {
    expect(boardOf([task(1, TODAY)], TODAY).sections.map((section) => section.bucket)).toEqual(['today'])
  })

  it('orders a day by importance, highest first, then by creation', () => {
    const board = boardOf(
      [task(1, TODAY, { importance: 'LOW' }), task(2, TODAY, { importance: 'HIGH' }), task(3, TODAY, { importance: 'LOW' })],
      TODAY,
    )

    expect(board.sections[0].tasks.map((t) => t.id)).toEqual([2, 1, 3])
  })

  it('counts a task in progress as open', () => {
    expect(boardOf([task(1, TODAY, { state: 'WORKING' })], TODAY).sections[0].tasks).toHaveLength(1)
  })

  it('keeps completed tasks apart, most recently due first', () => {
    const board = boardOf(
      [task(1, '2026-10-01', { state: 'DONE' }), task(2, '2026-10-05', { state: 'DONE' }), task(3, TODAY)],
      TODAY,
    )

    expect(board.completed.map((t) => t.id)).toEqual([2, 1])
    expect(board.sections.flatMap((section) => section.tasks).map((t) => t.id)).toEqual([3])
  })

  it('is empty when there is nothing at all', () => {
    expect(boardOf([], TODAY)).toEqual({ sections: [], completed: [] })
  })
})
