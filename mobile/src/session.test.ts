import { emailOf, hasEnded, type Session } from './session'
import { tokenWith } from './testing'

// Noon, not the shared NOW, and a session of its own.
const NOW = Date.UTC(2026, 9, 10, 12, 0, 0)
const DAY = 24 * 60 * 60 * 1000

const session: Session = { token: 'taskfest_app_ada', expiresAt: NOW + 30 * DAY, email: 'ada@example.com' }

describe('a session', () => {
  it('ends when the backend’s thirty days are over', () => {
    expect(hasEnded(session, NOW)).toBe(false)
    expect(hasEnded(session, NOW + 30 * DAY - 1)).toBe(false)
    expect(hasEnded(session, NOW + 30 * DAY)).toBe(true)
  })
})

describe('the signed-in address (#275)', () => {
  it('is the ID token’s email claim', () => {
    expect(emailOf(tokenWith({ email: 'ada@example.com' }))).toBe('ada@example.com')
  })

  it('reads an address beyond ASCII, as the token’s UTF-8 has it', () => {
    const claims = Buffer.from(JSON.stringify({ email: 'jörg@example.de' })).toString('base64url')

    expect(emailOf(`header.${claims}.signature`)).toBe('jörg@example.de')
  })

  it('is unknown when the token names none, or cannot be read', () => {
    expect(emailOf(tokenWith({ sub: 'ada' }))).toBeNull()
    expect(emailOf('not a token')).toBeNull()
    expect(emailOf('header.%%%.signature')).toBeNull()
  })
})
