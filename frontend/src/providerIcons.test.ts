import { describe, expect, it } from 'vitest'
import { iconFor } from './providerIcons'

describe('the icon a sign-in button carries', () => {
  it("is Google's own button for Google's issuer", () => {
    expect(iconFor('https://accounts.google.com')).toBe('google')
  })

  it('is the TaskFest mark for one of our Cognito pools', () => {
    expect(iconFor('https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_DMSNjceWw')).toBe('taskfest')
  })

  it('is a plain key for anything else', () => {
    expect(iconFor('http://localhost:8082/realms/taskfest')).toBe('key')
  })

  it('is a plain key for an issuer that only pretends to be Google', () => {
    expect(iconFor('https://accounts.google.com.example.org')).toBe('key')
  })

  it('is a plain key for no issuer at all', () => {
    expect(iconFor('')).toBe('key')
  })
})
