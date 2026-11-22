import type { GoogleOneTapSignIn } from 'react-native-nitro-google-signin'
import type { Tokens } from './staySignedIn'
import type { GoogleSignIn } from './variants'

/**
 * Signing in with Google through its own SDKs (#280, S1 on #264): Credential Manager on Android,
 * Google's Sign-In SDK on iOS, by way of react-native-nitro-google-signin. Google wants these on a
 * phone rather than a browser flow. The ID token it issues is traded once for an app session
 * (#281), so the SDK is never asked to renew it.
 */

/** The part of the library this uses, so tests can stand in for Google. */
export type GoogleSdk = Pick<typeof GoogleOneTapSignIn, 'configure' | 'presentExplicitSignIn' | 'signOut'>

/** Google's sign-in for a variant, through the SDK given. */
export function googleProviderFor(google: GoogleSignIn, sdk: GoogleSdk) {
  let configured = false
  const ready = () => {
    if (!configured) {
      sdk.configure({ webClientId: google.webClientId, iosClientId: google.iosClientId })
      configured = true
    }
    return sdk
  }

  return {
    /** Shows Google's sign-in; null when the user turned back, a rejection on an error. */
    async signIn(): Promise<Tokens | null> {
      const response = await ready().presentExplicitSignIn()
      return response.type === 'success' && response.data ? { idToken: response.data.idToken } : null
    },

    /** Forgets the account on the phone too, so the next sign-in asks which one. */
    async signOut(): Promise<void> {
      await ready().signOut()
    },
  }
}

/** What the app needs of Google's sign-in. */
export type GoogleProvider = ReturnType<typeof googleProviderFor>
