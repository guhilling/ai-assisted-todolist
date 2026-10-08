import { afterEach, describe, expect, it, vi } from 'vitest'
import { chooseLanguage, initialLanguage, localeOf, rememberLanguage, rememberedLanguage } from './language'

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

describe('the language at the start of a visit', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.removeItem('taskfest.language')
  })

  it("falls back to the browser's one language when it lists none", () => {
    // Some WebViews and hardened browsers report an empty list, but still a language.
    vi.stubGlobal('navigator', { languages: [], language: 'de-DE' })

    expect(initialLanguage()).toBe('de')
  })

  it('prefers the remembered choice', () => {
    localStorage.setItem('taskfest.language', 'de')
    vi.stubGlobal('navigator', { languages: ['en-US'], language: 'en-US' })

    expect(initialLanguage()).toBe('de')
  })

  it('carries on without storage, which a private window may refuse', () => {
    const refusing = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('SecurityError')
      },
    }
    vi.stubGlobal('localStorage', refusing)

    expect(rememberedLanguage()).toBeNull()
    expect(() => rememberLanguage('de')).not.toThrow()
  })
})

