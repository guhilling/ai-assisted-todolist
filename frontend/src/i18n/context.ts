import { createContext, useContext } from 'react'
import { localeOf, type Language } from './language'
import { catalogues, type Messages } from './messages'

/** The language the app speaks, its texts, its date locale, and how to change it. */
export type I18n = {
  language: Language
  messages: Messages
  locale: string
  /** Absent outside an `I18nProvider`, where there is nothing to switch -- and so no switch. */
  setLanguage?: (language: Language) => void
}

/**
 * English, with nothing to switch: what a component sees outside an `I18nProvider` -- in the
 * design system's bundle, say -- so it renders rather than failing for want of a provider.
 */
const english: I18n = { language: 'en', messages: catalogues.en, locale: localeOf('en') }

/** Carries the current language to every component; `I18nProvider` sets it. */
export const I18nContext = createContext<I18n>(english)

/** The current language's texts and locale. */
export function useI18n() {
  return useContext(I18nContext)
}
