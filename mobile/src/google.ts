import type { GoogleOneTapSignIn } from 'react-native-nitro-google-signin'
import type { Tokens } from './staySignedIn'
import { withinLimit } from './timeLimit'
import type { GoogleSignIn } from './variants'

/**
 * Signing in with Google through its own SDKs (#280, S1 on #264): Credential Manager on Android,
 * Google's Sign-In SDK on iOS, by way of react-native-nitro-google-signin. Google wants these on a
 * phone rather than a browser flow, and gives the app no refresh token: the SDK keeps what it needs
 * and renews the ID token itself.
 *
 * Renewing differs by platform, which is why the platform is passed in. On Android the ID token
 * the library keeps is never renewed, so renewing is a silent sign-in again: Credential Manager
 * picks the account already chosen, without asking. On iOS a silent sign-in restores the session
 * and `getTokens` renews its tokens.
 */

/** The part of the library this uses, so tests can stand in for Google. */
export type GoogleSdk = Pick<typeof GoogleOneTapSignIn, 'configure' | 'presentExplicitSignIn' | 'signIn' | 'getTokens' | 'signOut'>

/** The OAuth error a refused renewal is reported as: the session then ends, as with a refused refresh token. */
const REFUSED = 'invalid_grant'

/** The library's code for "nobody is signed in with Google on this phone". */
const SIGN_IN_REQUIRED = 'SIGN_IN_REQUIRED'

function refused(reason: string) {
  return Object.assign(new Error(`Google will not renew the sign-in: ${reason}.`), { code: REFUSED })
}

/** Google's sign-in for a variant, through the SDK given. */
export function googleProviderFor(google: GoogleSignIn, sdk: GoogleSdk, platform: string) {
  let configured = false
  const ready = () => {
    if (!configured) {
      // autoSelectOnSignIn: a silent sign-in -- the renewal -- picks the one account already
      // chosen instead of showing the account sheet.
      sdk.configure({ webClientId: google.webClientId, iosClientId: google.iosClientId, autoSelectOnSignIn: true })
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

    /** A fresh ID token for the account signed in; rejects with `invalid_grant` when Google refuses. */
    async renew(): Promise<Tokens> {
      let response
      try {
        response = await withinLimit(() => ready().signIn())
      } catch (failure) {
        if ((failure as { code?: unknown }).code === SIGN_IN_REQUIRED) {
          throw refused('nobody is signed in')
        }
        throw failure
      }
      if (response.type !== 'success' || !response.data) {
        throw refused(response.type)
      }
      if (platform === 'ios') {
        const tokens = await withinLimit(() => sdk.getTokens())
        return { idToken: tokens.idToken }
      }
      return { idToken: response.data.idToken }
    },

    /** Forgets the account on the phone too, so the next sign-in asks which one. */
    async signOut(): Promise<void> {
      await ready().signOut()
    },
  }
}

/** What the app needs of Google's sign-in. */
export type GoogleProvider = ReturnType<typeof googleProviderFor>
