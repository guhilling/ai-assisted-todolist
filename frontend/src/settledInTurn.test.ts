import { describe, expect, it } from 'vitest'
import { settledInTurn } from './settledInTurn'

describe('settledInTurn', () => {
  it('runs at most so many at a time, and answers in the order given', async () => {
    let running = 0
    let most = 0
    const work = async (n: number) => {
      running++
      most = Math.max(most, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running--
      return n * 2
    }

    const outcomes = await settledInTurn([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4, work)

    expect(most).toBe(4)
    expect(outcomes.map((o) => (o.status === 'fulfilled' ? o.value : null))).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20])
  })

  it('keeps going after a failure, and reports it in its place, as Promise.allSettled does', async () => {
    const outcomes = await settledInTurn([1, 2, 3], 2, async (n) => {
      if (n === 2) {
        throw new Error('two')
      }
      return n
    })

    expect(outcomes[0]).toEqual({ status: 'fulfilled', value: 1 })
    expect(outcomes[1].status).toBe('rejected')
    expect(outcomes[2]).toEqual({ status: 'fulfilled', value: 3 })
  })

  it('answers an empty list at once', async () => {
    expect(await settledInTurn([], 4, async () => 1)).toEqual([])
  })
})
