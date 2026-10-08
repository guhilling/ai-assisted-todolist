/**
 * Which language the app speaks, and how a date is written in it (#203).
 *
 * The visitor's own choice wins, remembered in this browser; otherwise the browser's preferences
 * decide, by their first language the app has; otherwise English. A choice is matched by its
 * language alone, so `de-CH` gets German.
 */
export const languages = ['en', 'de'] as const

/** A language the app has a message catalogue for. */
export type Language = (typeof languages)[number]

/** Each language's own name, for the switch: shown in the language it switches to. */
export const languageNames: Record<Language, string> = { en: 'English', de: 'Deutsch' }

/**
 * The locale dates are formatted in. British English rather than American, as before #203: day
 * before month, "31 Dec".
 */
const locales: Record<Language, string> = { en: 'en-GB', de: 'de-DE' }

/** Where the visitor's choice is remembered. A per-browser convenience, nothing more. */
const STORAGE_KEY = 'taskfest.language'

function isLanguage(candidate: string | null | undefined): candidate is Language {
  return (languages as readonly string[]).includes(candidate ?? '')
}

/** The language to speak, from a remembered choice and the browser's preferences. */
export function chooseLanguage(remembered: string | null, preferred: readonly string[]): Language {
  if (isLanguage(remembered)) {
    return remembered
  }
  for (const tag of preferred) {
    const language = tag.toLowerCase().split('-')[0]
    if (isLanguage(language)) {
      return language
    }
  }
  return 'en'
}

/** The locale a language formats dates in. */
export function localeOf(language: Language) {
  return locales[language]
}

/** The visitor's remembered choice, or null; storage may be unavailable, which is no error. */
export function rememberedLanguage(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

/** Remembers the visitor's choice in this browser, if storage allows. */
export function rememberLanguage(language: Language) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, language)
  } catch {
    // Private mode or blocked storage: the choice simply lasts until the page is left.
  }
}

/** The language for this visit: the remembered choice, else the browser's preferences. */
export function initialLanguage(): Language {
  // Some WebViews and hardened browsers report no list at all, or an empty one, but still a language.
  if (typeof navigator === 'undefined') {
    return chooseLanguage(rememberedLanguage(), [])
  }
  const listed = navigator.languages ?? []
  const preferred = listed.length > 0 ? listed : [navigator.language]
  return chooseLanguage(rememberedLanguage(), preferred)
}
