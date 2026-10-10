import { INACTIVITY_LIMIT_MS, emailOf, expiryOf, isInactive, needsRefresh, used, type Session } from './session'

/** A token with the given payload; the header and signature do not matter to the app. */
function tokenWith(payload: object) {
  const encoded = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${encoded}.signature`
}

const NOW = Date.UTC(2026, 9, 10, 12, 0, 0)

const session: Session = {
  idToken: tokenWith({ exp: NOW / 1000 + 3600 }),
  refreshToken: 'refresh',
  expiresAt: NOW + 3600 * 1000,
  lastUsedAt: NOW,
}

describe('a session', () => {
  it('expires when its ID token does', () => {
    expect(expiryOf(tokenWith({ exp: 1_800_000_000 }))).toBe(1_800_000_000_000)
  })

  it('reads the expiry from a token whose payload needs base64url', () => {
    // `?` and `>` encode to `/` and `+` in plain base64, which a JWT spells `_` and `-`.
    expect(expiryOf(tokenWith({ exp: 1_800_000_000, name: '??>>' }))).toBe(1_800_000_000_000)
  })

  it('cannot tell the expiry of something that is not a token', () => {
    expect(expiryOf('not a token')).toBeNull()
    expect(expiryOf(tokenWith({ sub: 'no exp' }))).toBeNull()
  })

  it('is renewed a minute before its ID token runs out, not after', () => {
    expect(needsRefresh(session, NOW)).toBe(false)
    expect(needsRefresh(session, session.expiresAt - 61_000)).toBe(false)
    expect(needsRefresh(session, session.expiresAt - 60_000)).toBe(true)
    expect(needsRefresh(session, session.expiresAt + 1)).toBe(true)
  })

  it('ends after thirty days without use', () => {
    expect(INACTIVITY_LIMIT_MS).toBe(30 * 24 * 60 * 60 * 1000)
    expect(isInactive(session, NOW + INACTIVITY_LIMIT_MS)).toBe(false)
    expect(isInactive(session, NOW + INACTIVITY_LIMIT_MS + 1)).toBe(true)
  })

  it('starts the thirty days again whenever it is used', () => {
    const later = NOW + 20 * 24 * 60 * 60 * 1000
    const renewed = used(session, later)

    expect(renewed.lastUsedAt).toBe(later)
    expect(isInactive(renewed, NOW + INACTIVITY_LIMIT_MS + 1)).toBe(false)
    expect(session.lastUsedAt).toBe(NOW)
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
