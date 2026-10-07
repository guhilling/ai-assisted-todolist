/**
 * Which icon a sign-in button carries, decided by the provider's issuer (#190).
 *
 * By the issuer rather than the provider's id, so no provider is named in the frontend: Google's
 * branding rules belong to Google as the identity provider, wherever a deployment declares it.
 * Google gets its own official button; a Cognito pool -- ours, the test accounts -- the TaskFest
 * mark; anything else a plain key. No other provider has an official sign-in icon we may use: AWS's
 * icons are licensed for architecture diagrams, not login buttons.
 */
export type ProviderIcon = 'google' | 'taskfest' | 'key'

/** Matches the host of a Cognito user pool's issuer, `cognito-idp.<region>.amazonaws.com`. */
const COGNITO_HOST = /^cognito-idp\.[a-z0-9-]+\.amazonaws\.com$/

/** The icon for a provider with this issuer; an issuer that does not parse gets the plain key. */
export function iconFor(issuer: string): ProviderIcon {
  let host: string
  try {
    host = new URL(issuer).hostname
  } catch {
    return 'key'
  }
  if (host === 'accounts.google.com') {
    return 'google'
  }
  return COGNITO_HOST.test(host) ? 'taskfest' : 'key'
}
