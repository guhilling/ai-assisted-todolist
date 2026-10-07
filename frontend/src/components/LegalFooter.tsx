import { purposeUrl } from './SignedOut'

/** The operator's imprint: Hilling IT GmbH runs TaskFest (#193). */
export const imprintUrl = 'https://www.hilling.it/impressum/'

/** The privacy policy, published with the documentation. */
export const privacyUrl = 'https://taskfest-docs.cloud.hilling.de/doc/privacy.html'

/**
 * The release this page was built from, or that it is none: the release build sets
 * `VITE_TASKFEST_VERSION` from the tag (release.yml); every other build leaves it unset.
 */
function versionLabel() {
  const version = import.meta.env.VITE_TASKFEST_VERSION
  return version ? `Version ${version}` : 'Development build'
}

/**
 * The links at the bottom of every view: what this project is, and the legal ones -- the imprint,
 * the privacy policy, and a contact -- and which version is running.
 *
 * German law asks a public site to name its provider within one click from every page (§ 5 DDG,
 * § 18 MStV), so this sits on the signed-out page, the paused page and the board alike. The
 * contact address is written as `demo-apps[at]hilling.de` and is deliberately not a `mailto:`
 * link, so address harvesters find nothing to collect -- Gunnar's call, to keep the spam down.
 */
function LegalFooter() {
  return (
    <footer className="legal-footer">
      <a className="text-link" href={purposeUrl} target="_blank" rel="noreferrer">
        About ↗
      </a>
      <a className="text-link" href={imprintUrl} target="_blank" rel="noreferrer">
        Imprint
      </a>
      <a className="text-link" href={privacyUrl} target="_blank" rel="noreferrer">
        Privacy
      </a>
      <span>
        Contact: <span className="legal-footer-contact">demo-apps[at]hilling.de</span>
      </span>
      <span>{versionLabel()}</span>
    </footer>
  )
}

export default LegalFooter
