/**
 * Where the footer's legal links go (#193, #203), and the documentation, which the app also links
 * at its top (#384). Their own module, so the component files export only their components, the
 * design system can export the addresses, and the app imports the same ones.
 */
import type { Language } from './i18n/language'

/**
 * Where the project explains itself: its purpose page in the published documentation, rendered and
 * with the rest of the docs around it, rather than the Markdown file on GitHub. Linked rather than
 * inlined, so the board stays a board. The website's footer and the top of the app link it (#384).
 */
export const purposeUrl = 'https://taskfest-docs.cloud.hilling.de/doc/purpose.html'

/** The operator's imprint: Hilling IT GmbH runs TaskFest (#193). */
export const imprintUrl = 'https://www.hilling.it/impressum/'

/** The privacy policy in each language, published with the documentation (D4 on #203). */
export const privacyUrls: Record<Language, string> = {
  en: 'https://taskfest-docs.cloud.hilling.de/doc/privacy.html',
  de: 'https://taskfest-docs.cloud.hilling.de/doc/datenschutz.html',
}

/** The terms of service in each language, published beside the privacy policy; the app links them (#275). */
export const termsUrls: Record<Language, string> = {
  en: 'https://taskfest-docs.cloud.hilling.de/doc/terms.html',
  de: 'https://taskfest-docs.cloud.hilling.de/doc/nutzungsbedingungen.html',
}

/** The English privacy policy; kept for the design system's consumers. */
export const privacyUrl = privacyUrls.en
