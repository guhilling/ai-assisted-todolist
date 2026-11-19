import { AppleAuthenticationScope, type isAvailableAsync, type signInAsync } from 'expo-apple-authentication'
import type { Tokens } from './staySignedIn'
import type { Variant } from './variants'

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
  /**
   * Runs Apple's sheet once more to confirm deleting the account (#635), and hands over the
   * authorization code it issues, with which the backend revokes TaskFest's authorization at Apple;
   * null when the person turned it away, a rejection on an error.
   */
  confirm(): Promise<string | null>
}

/** The code with which Apple's sheet says the person turned it away. */
const CANCELED = 'ERR_REQUEST_CANCELED'

/** Sign in with Apple through the native module. */
export function appleProviderFor(apple: AppleAuthentication): AppleProvider {
  return {
    available: () => apple.isAvailableAsync().catch(() => false),

    async signIn() {
      const credential = await sheet(apple, [AppleAuthenticationScope.EMAIL])
      if (!credential) {
        return null
      }
      if (!credential.identityToken) {
        throw new Error('Apple issued no ID token.')
      }
      return { idToken: credential.identityToken }
    },

    async confirm() {
      // Nothing asked for: the backend needs only the code, and the account is known already.
      const credential = await sheet(apple, [])
      if (!credential) {
        return null
      }
      if (!credential.authorizationCode) {
        throw new Error('Apple issued no authorization code.')
      }
      return credential.authorizationCode
    },
  }
}

/** Apple's sheet, asking for scopes: what it issued, or null when the person turned it away. */
async function sheet(apple: AppleAuthentication, requestedScopes: AppleAuthenticationScope[]) {
  try {
    return await apple.signInAsync({ requestedScopes })
  } catch (failure) {
    if ((failure as { code?: unknown }).code === CANCELED) {
      return null
    }
    throw failure
  }
}

/**
 * Sign in with Apple where it is offered (#281): on iOS, where the build has it -- the one place
 * that decides, so the sign-in screen only asks whether the phone can. Apple has no sign-in for
 * Android apps of its own.
 */
export function appleSignInFor(variant: Pick<Variant, 'apple'>, os: string, apple: AppleAuthentication): AppleProvider | undefined {
  return variant.apple && os === 'ios' ? appleProviderFor(apple) : undefined
}
