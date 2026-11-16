import type { AuthProvidersResponse } from '../api'
import googleDark from '../assets/google-sign-in-dark.png'
import googleDark2x from '../assets/google-sign-in-dark@2x.png'
import googleDark3x from '../assets/google-sign-in-dark@3x.png'
import googleLight from '../assets/google-sign-in-light.png'
import googleLight2x from '../assets/google-sign-in-light@2x.png'
import googleLight3x from '../assets/google-sign-in-light@3x.png'
import appleDeDark from '../assets/apple-sign-in-de-dark.png'
import appleDeDark2x from '../assets/apple-sign-in-de-dark@2x.png'
import appleDeDark3x from '../assets/apple-sign-in-de-dark@3x.png'
import appleDeLight from '../assets/apple-sign-in-de-light.png'
import appleDeLight2x from '../assets/apple-sign-in-de-light@2x.png'
import appleDeLight3x from '../assets/apple-sign-in-de-light@3x.png'
import appleEnDark from '../assets/apple-sign-in-en-dark.png'
import appleEnDark2x from '../assets/apple-sign-in-en-dark@2x.png'
import appleEnDark3x from '../assets/apple-sign-in-en-dark@3x.png'
import appleEnLight from '../assets/apple-sign-in-en-light.png'
import appleEnLight2x from '../assets/apple-sign-in-en-light@2x.png'
import appleEnLight3x from '../assets/apple-sign-in-en-light@3x.png'
import key from '../assets/key.svg'
import taskfestMark from '../assets/taskfest-mark.svg'
import { iconFor } from '../providerIcons'
import { useI18n } from '../i18n/context'
import type { Language } from '../i18n/language'

/**
 * Apple's button as Apple's server draws it (#281), in each language and theme, at 180 by 40 like
 * Google's: Apple's rules want its button no smaller than any other sign-in button, and its logo
 * only as Apple supplies it. White with an outline on the light page, white without one on the
 * dark page, where Apple forbids its black button. Fetched from
 * `https://appleid.cdn-apple.com/appleid/button?height=40&width=180&color=white&border=<true for
 * light>&type=sign-in&locale=<en_US|de_DE>&scale=<1|2|3>`.
 */
const appleButtons: Record<Language, { light: string[]; dark: string[] }> = {
  en: { light: [appleEnLight, appleEnLight2x, appleEnLight3x], dark: [appleEnDark, appleEnDark2x, appleEnDark3x] },
  de: { light: [appleDeLight, appleDeLight2x, appleDeLight3x], dark: [appleDeDark, appleDeDark2x, appleDeDark3x] },
}

/** A `srcSet` of an image at 1x, 2x and 3x. */
function scaled([one, two, three]: string[]): string {
  return `${one} 1x, ${two} 2x, ${three} 3x`
}

type SignedOutProps = {
  providers: AuthProvidersResponse
  /**
   * What a provider's `loginUrl` is relative to, passed in rather than read from the wire
   * module. The component used to import `apiBaseUrl` from `api.ts`, which pulled the whole
   * wire layer -- generated validators included -- into anything that rendered a sign-in
   * screen. It is the caller that knows where the API lives, and this is the only fact about
   * it the component needs.
   */
  apiBaseUrl: string
}

/**
 * What an anonymous visitor sees: the app's name, a way in, and a link to what this is.
 *
 * Only providers the backend reports as `available` are offered, since an unavailable one has
 * no `loginUrl` and a card for it is a dead end. The buttons stand one under another, all in
 * Google's neutral style -- white, or dark in a dark theme -- each with its provider's icon
 * (`providerIcons.ts`): Google's rules require its button to be at least as prominent as any other. In practice exactly one is available -- the
 * profile decides whether that is Google or the local Keycloak -- so the normal render is a
 * single button and no chooser at all.
 *
 * Deliberately not an automatic redirect to that single provider. This repository exists to
 * be read, and bouncing every visitor to an identity provider would leave nowhere to say so.
 */
function SignedOut({ providers, apiBaseUrl }: Readonly<SignedOutProps>) {
  const { messages, language } = useI18n()
  const available = providers.providers.filter((provider) => provider.available && provider.loginUrl)

  return (
    <div className="signed-out">
      <h1 className="signed-out-title">TaskFest</h1>
      <p className="signed-out-copy">{messages.signedOut.tagline}</p>

      {available.length === 0 ? (
        <p className="signed-out-note">{messages.signedOut.notConfigured}</p>
      ) : (
        <div className="signed-out-actions">
          {available.map((provider) => {
            const href = `${apiBaseUrl}${provider.loginUrl}`
            const icon = iconFor(provider.issuer)
            if (icon === 'google') {
              // Google's official button as it comes -- its rules allow the "G" only inside it, in
              // Google's own light or dark theme, with Google's font -- so the image is the button.
              // The PNGs, not the SVGs: Google's SVGs draw the G through a <foreignObject>, which
              // Safari renders as a blur. srcSet picks the sharp one for the screen.
              return (
                // lang="en": the image and its alt are Google's English, whatever the page speaks (D3 on
                // #203), and a screen reader should pronounce them as English.
                <a className="sign-in-google" key={provider.id} href={href} lang="en">
                  <picture>
                    <source
                      srcSet={`${googleDark} 1x, ${googleDark2x} 2x, ${googleDark3x} 3x`}
                      media="(prefers-color-scheme: dark)"
                    />
                    <img
                      src={googleLight}
                      srcSet={`${googleLight} 1x, ${googleLight2x} 2x, ${googleLight3x} 3x`}
                      alt={messages.signedOut.google}
                      width={180}
                      height={40}
                    />
                  </picture>
                </a>
              )
            }
            if (icon === 'apple') {
              const apple = appleButtons[language]
              return (
                <a className="sign-in-apple" key={provider.id} href={href}>
                  <picture>
                    <source srcSet={scaled(apple.dark)} media="(prefers-color-scheme: dark)" />
                    <img src={apple.light[0]} srcSet={scaled(apple.light)} alt={messages.signedOut.apple} width={180} height={40} />
                  </picture>
                </a>
              )
            }
            return (
              <a className="sign-in-button" key={provider.id} href={href}>
                <img className="sign-in-icon" src={icon === 'taskfest' ? taskfestMark : key} alt="" width={20} height={20} />
                {messages.signedOut.signInWith(provider.label)}
              </a>
            )
          })}
          {available.some((provider) => iconFor(provider.issuer) === 'apple') && (
            <p className="signed-out-note">{messages.signedOut.appleHiddenEmail}</p>
          )}
        </div>
      )}
    </div>
  )
}

export default SignedOut
