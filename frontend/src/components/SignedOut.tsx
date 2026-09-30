import type { AuthProvidersResponse } from '../api'

/** Where the project explains itself. Linked rather than inlined, so the board stays a board. */
export const purposeUrl = 'https://github.com/guhilling/ai-assisted-todolist/blob/main/doc/purpose.md'

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
 * no `loginUrl` and a card for it is a dead end. In practice exactly one is available -- the
 * profile decides whether that is Google or the local Keycloak -- so the normal render is a
 * single button and no chooser at all.
 *
 * Deliberately not an automatic redirect to that single provider. This repository exists to
 * be read, and bouncing every visitor to an identity provider would leave nowhere to say so.
 */
function SignedOut({ providers, apiBaseUrl }: SignedOutProps) {
  const available = providers.providers.filter((provider) => provider.available && provider.loginUrl)

  return (
    <div className="signed-out">
      <h1 className="signed-out-title">Tasks</h1>
      <p className="signed-out-copy">Your own list, private to whoever signs in.</p>

      {available.length === 0 ? (
        <p className="signed-out-note">Sign-in is not configured for this deployment.</p>
      ) : (
        <div className="signed-out-actions">
          {available.map((provider) => (
            <a className="button-primary" key={provider.id} href={`${apiBaseUrl}${provider.loginUrl}`}>
              Continue with {provider.label}
            </a>
          ))}
        </div>
      )}

      <a className="text-link" href={purposeUrl} target="_blank" rel="noreferrer">
        About this project ↗
      </a>
    </div>
  )
}

export default SignedOut
