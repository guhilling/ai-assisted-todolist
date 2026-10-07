/** The operator's imprint: Hilling IT GmbH runs TaskFest (#193). */
export const imprintUrl = 'https://www.hilling.it/impressum/'

/** The privacy policy, published with the documentation. */
export const privacyUrl = 'https://taskfest-docs.cloud.hilling.de/doc/privacy.html'

/**
 * The legal links at the bottom of every view: the imprint, the privacy policy, and a contact.
 *
 * German law asks a public site to name its provider within one click from every page (§ 5 DDG,
 * § 18 MStV), so this sits on the signed-out page, the paused page and the board alike. The
 * contact address is written as `demo-apps[at]hilling.de` and is deliberately not a `mailto:`
 * link, so address harvesters find nothing to collect -- Gunnar's call, to keep the spam down.
 */
function LegalFooter() {
  return (
    <footer className="legal-footer">
      <a className="text-link" href={imprintUrl} target="_blank" rel="noreferrer" title="Impressum" lang="en">
        Imprint
      </a>
      <a className="text-link" href={privacyUrl} target="_blank" rel="noreferrer">
        Privacy
      </a>
      <span>
        Contact: <span className="legal-footer-contact">demo-apps[at]hilling.de</span>
      </span>
    </footer>
  )
}

export default LegalFooter
