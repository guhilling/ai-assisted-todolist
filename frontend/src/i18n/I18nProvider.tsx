import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { I18nContext, type I18n } from './context'
import { initialLanguage, localeOf, rememberLanguage, type Language } from './language'
import { catalogues } from './messages'
/**
 * Speaks the visitor's language to everything inside it (#203).
 *
 * The language starts as the remembered choice or the browser's preference
 * (`language.ts`); changing it is remembered, and `<html lang>` follows, so screen readers
 * pronounce the page in the language it is written in.
 */
export function I18nProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [language, setLanguage] = useState<Language>(() => initialLanguage())

  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  const value = useMemo<I18n>(
    () => ({
      language,
      messages: catalogues[language],
      locale: localeOf(language),
      setLanguage: (next) => {
        rememberLanguage(next)
        setLanguage(next)
      },
    }),
    [language],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
