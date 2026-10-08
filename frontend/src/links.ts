/**
 * Where the footer's legal links go (#193, #203). Their own module, so the component file exports
 * only its component and the design system can export the addresses.
 */
import type { Language } from './i18n/language'

/** The operator's imprint: Hilling IT GmbH runs TaskFest (#193). */
export const imprintUrl = 'https://www.hilling.it/impressum/'

/** The privacy policy in each language, published with the documentation (D4 on #203). */
export const privacyUrls: Record<Language, string> = {
  en: 'https://taskfest-docs.cloud.hilling.de/doc/privacy.html',
  de: 'https://taskfest-docs.cloud.hilling.de/doc/datenschutz.html',
}

/** The English privacy policy; kept for the design system's consumers. */
export const privacyUrl = privacyUrls.en
