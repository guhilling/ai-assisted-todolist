import { AppleAuthenticationScope, type isAvailableAsync, type signInAsync } from 'expo-apple-authentication'
import type { Tokens } from './staySignedIn'

/**
 * Sign in with Apple on iOS (#281), natively, with `expo-apple-authentication`: Apple's own sheet,
 * no browser. Apple hands the app an ID token it cannot renew without the person, so the app
 * trades it for an app session at once, as it does every provider's
 * (doc/decisions/authentication.md). Only the address is asked for: the backend keys the account
 * by it, and the app shows no name it would need Apple's for. Apple has no SDK for Android.
 */

/** The part of expo-apple-authentication this needs, so tests can stand in for Apple's sheet. */
export type AppleAuthentication = {
  isAvailableAsync: typeof isAvailableAsync
  signInAsync: typeof signInAsync
}

/** Sign in with Apple, as the sign-in screen offers it. */
export type AppleProvider = {
  /** Whether this phone can sign in with Apple; false when it cannot say. */
  available(): Promise<boolean>
  /** Runs Apple's sheet; null when the person turned it away, a rejection on an error. */
  signIn(): Promise<Tokens | null>
}

/** The code with which Apple's sheet says the person turned it away. */
const CANCELED = 'ERR_REQUEST_CANCELED'

/** Sign in with Apple through the native module. */
export function appleProviderFor(apple: AppleAuthentication): AppleProvider {
  return {
    available: () => apple.isAvailableAsync().catch(() => false),

    async signIn() {
      let credential: Awaited<ReturnType<typeof signInAsync>>
      try {
        credential = await apple.signInAsync({ requestedScopes: [AppleAuthenticationScope.EMAIL] })
      } catch (failure) {
        if ((failure as { code?: unknown }).code === CANCELED) {
          return null
        }
        throw failure
      }
      if (!credential.identityToken) {
        throw new Error('Apple issued no ID token.')
      }
      return { idToken: credential.identityToken }
    },
  }
}
