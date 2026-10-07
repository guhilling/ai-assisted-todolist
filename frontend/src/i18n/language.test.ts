import { describe, expect, it } from 'vitest'
import { chooseLanguage, localeOf } from './language'

describe('the language the app speaks', () => {
  it('is the one the visitor chose last, whatever the browser prefers', () => {
    expect(chooseLanguage('de', ['en-US', 'en'])).toBe('de')
  })

  it("is otherwise the browser's first preference the app has", () => {
    expect(chooseLanguage(null, ['fr-FR', 'de-AT', 'en'])).toBe('de')
  })

  it('matches a regional preference by its language', () => {
    expect(chooseLanguage(null, ['de-CH'])).toBe('de')
  })

  it('falls back to English when nothing matches', () => {
    expect(chooseLanguage(null, ['fr-FR', 'ja'])).toBe('en')
  })

  it('ignores a remembered choice it does not know', () => {
    expect(chooseLanguage('xx', ['de'])).toBe('de')
  })

  it('formats dates the way the language does', () => {
    expect(localeOf('en')).toBe('en-GB')
    expect(localeOf('de')).toBe('de-DE')
  })
})
