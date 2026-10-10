import { AuthRequest, exchangeCodeAsync, fetchDiscoveryAsync, makeRedirectUri, refreshAsync } from 'expo-auth-session'
import type { Tokens } from './staySignedIn'
import type { SignIn } from './variants'

/**
 * Signing in the way RFC 8252 asks of a native app (#264, #267): the system browser, a public
 * client, PKCE, and the tokens kept on the device. The ID token is what the backend is sent; the
 * access token is never used.
 *
 * Google's sign-in will not go this way -- Google wants its own SDKs on phones -- and comes with
 * #280. This is for OpenID Connect providers that allow it: the local Keycloak and qa's Cognito.
 */
export function providerFor(signIn: SignIn, scheme: string) {
  const redirectUri = makeRedirectUri({ scheme, path: 'oauthredirect' })
  // Asked for once and kept, unless asking failed: renewing should not cost a round trip more.
  let document: ReturnType<typeof fetchDiscoveryAsync> | null = null
  const discovery = () => {
    document ??= fetchDiscoveryAsync(signIn.issuer).catch((failure: unknown) => {
      document = null
      throw failure
    })
    return document
  }

  return {
    /** Runs the sign-in in the browser; null when the user turned back, a rejection on an error. */
    async signIn(): Promise<Tokens | null> {
      const document = await discovery()
      const request = new AuthRequest({ clientId: signIn.clientId, scopes: signIn.scopes, redirectUri, usePKCE: true })
      const result = await request.promptAsync(document)
      if (result.type === 'error') {
        throw result.error ?? new Error('The provider reported an error.')
      }
      if (result.type !== 'success') {
        return null
      }
      const tokens = await exchangeCodeAsync(
        {
          clientId: signIn.clientId,
          code: result.params.code,
          redirectUri,
          extraParams: { code_verifier: request.codeVerifier ?? '' },
        },
        document,
      )
      return { idToken: tokens.idToken, refreshToken: tokens.refreshToken }
    },

    /** Renews the tokens; rejects when the provider will not. */
    async refresh(refreshToken: string): Promise<Tokens> {
      const tokens = await refreshAsync({ clientId: signIn.clientId, refreshToken }, await discovery())
      return { idToken: tokens.idToken, refreshToken: tokens.refreshToken }
    },
  }
}
