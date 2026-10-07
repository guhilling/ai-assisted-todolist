import { purposeUrl } from './SignedOut'
import { useI18n } from '../i18n/context'
import { languageNames, languages } from '../i18n/language'
import type { Messages } from '../i18n/messages'

/** The operator's imprint: Hilling IT GmbH runs TaskFest (#193). */
export const imprintUrl = 'https://www.hilling.it/impressum/'

/** The privacy policy, published with the documentation. */
export const privacyUrl = 'https://taskfest-docs.cloud.hilling.de/doc/privacy.html'

/**
 * The release this page was built from, or that it is none: the release build sets
 * `VITE_TASKFEST_VERSION` from the tag (release.yml); every other build leaves it unset.
 */
function versionLabel(messages: Messages) {
  const version = import.meta.env.VITE_TASKFEST_VERSION
  return version ? messages.footer.version(version) : messages.footer.developmentBuild
}

/**
 * The links at the bottom of every view: what this project is, and the legal ones -- the imprint,
 * the privacy policy, and a contact -- which version is running, and the switch to another
 * language (#203).
 *
 * German law asks a public site to name its provider within one click from every page (§ 5 DDG,
 * § 18 MStV), so this sits on the signed-out page, the paused page and the board alike. The
 * contact address is written as `demo-apps[at]hilling.de` and is deliberately not a `mailto:`
 * link, so address harvesters find nothing to collect -- Gunnar's call, to keep the spam down.
 */
function LegalFooter() {
  const { language, messages, setLanguage } = useI18n()

  return (
    <footer className="legal-footer">
      <a className="text-link" href={purposeUrl} target="_blank" rel="noreferrer">
        {messages.footer.about}
      </a>
      <a className="text-link" href={imprintUrl} target="_blank" rel="noreferrer">
        {messages.footer.imprint}
      </a>
      <a className="text-link" href={privacyUrl} target="_blank" rel="noreferrer">
        {messages.footer.privacy}
      </a>
      <span>
        {messages.footer.contact} <span className="legal-footer-contact">demo-apps[at]hilling.de</span>
      </span>
      <span>{versionLabel(messages)}</span>
      {/* Every other language, each named in itself and marked as such for screen readers. */}
      {/* Only where the language can be changed: outside an I18nProvider there is no switch. */}
      {setLanguage &&
        languages
          .filter((other) => other !== language)
          .map((other) => (
            <button
              key={other}
              type="button"
              className="text-link legal-footer-language"
              lang={other}
              onClick={() => setLanguage(other)}
            >
              {languageNames[other]}
            </button>
          ))}
    </footer>
  )
}

export default LegalFooter
