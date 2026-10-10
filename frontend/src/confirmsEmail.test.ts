import { describe, expect, it } from 'vitest'
import { confirmsEmail } from './confirmsEmail'

describe('confirming an account deletion by its address (#213, #275)', () => {
  it('takes the address in any case, with spaces around it', () => {
    expect(confirmsEmail(' Ada@Example.com ', 'ada@example.com')).toBe(true)
  })

  it('takes nothing less than the whole address', () => {
    expect(confirmsEmail('ada@example.co', 'ada@example.com')).toBe(false)
    expect(confirmsEmail('', 'ada@example.com')).toBe(false)
  })
})
