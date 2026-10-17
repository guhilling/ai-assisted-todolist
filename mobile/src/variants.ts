/**
 * The three builds of the app, one per environment (#264, #267): installable side by side, each
 * with its own bundle id, name, URL scheme and backend.
 *
 * Read by `app.config.ts` when a build is made, which puts the chosen one into the app's
 * configuration; `Main.tsx` reads it back at runtime. `APP_VARIANT` chooses, and is `dev` unless
 * set. The scheme is the bundle id, so a sign-in in the browser returns to the variant that
 * started it and no other app can claim the redirect by accident.
 */

/**
 * How a variant signs in: an OpenID Connect provider, the app's own public client there, and the
 * scopes to ask for -- which differ, because a long-lived refresh token is `offline_access` at
 * Keycloak and an error at Cognito, whose client sets the refresh token's lifetime instead.
 */
export type SignIn = { label: string; issuer: string; clientId: string; scopes: string[] }

const OPENID_SCOPES = ['openid', 'email', 'profile']

/**
 * Signing in with Google (#280), through Google's own SDKs rather than the browser. The ID tokens
 * are asked for on behalf of the web client, whose id is the audience the backend accepts; the
 * iOS SDK needs the iOS client of the app's bundle id besides. Android's client is registered with
 * Google by package name and signing key, and never named in the app.
 */
export type GoogleSignIn = { webClientId: string; iosClientId: string }

/** Everything that differs between the builds. */
export type Variant = {
  name: string
  bundleId: string
  scheme: string
  apiBaseUrl: string
  /** Null where no provider is available to the app yet. */
  signIn: SignIn | null
  /** Google's sign-in, where the build knows its client ids; absent or null elsewhere. */
  google?: GoogleSignIn | null
}

/** The variant names `APP_VARIANT` accepts. */
export type VariantName = 'dev' | 'qa' | 'prod'

/** Build-time values a variant may need: qa's test accounts and Google's client ids come from here. */
export type BuildEnvironment = Record<string, string | undefined>

const BUNDLE_ID = 'de.hilling.taskfest'

function variant(
  name: string,
  bundleId: string,
  apiBaseUrl: string,
  signIn: SignIn | null,
  google: GoogleSignIn | null = null,
): Variant {
  return { name, bundleId, scheme: bundleId, apiBaseUrl, signIn, google }
}

/**
 * qa's test accounts: a Cognito pool and the app's public client in it. Both are made by
 * OpenTofu and known only once qa exists, so the build is told them rather than this file.
 */
function qaSignIn(env: BuildEnvironment): SignIn | null {
  const issuer = env.TASKFEST_QA_COGNITO_ISSUER
  const clientId = env.TASKFEST_QA_APP_CLIENT_ID
  return issuer && clientId ? { label: 'TaskFest test account', issuer, clientId, scopes: OPENID_SCOPES } : null
}

/**
 * Google's client ids for qa or prod: one web client for both, an iOS client per bundle id. Like
 * qa's test accounts, they are the build's to supply -- repository variables, not this file.
 */
function googleSignIn(env: BuildEnvironment, prefix: 'QA' | 'PROD'): GoogleSignIn | null {
  const webClientId = env.TASKFEST_GOOGLE_WEB_CLIENT_ID
  const iosClientId = env[`TASKFEST_${prefix}_GOOGLE_IOS_CLIENT_ID`]
  return webClientId && iosClientId ? { webClientId, iosClientId } : null
}

/**
 * The URL scheme Google's iOS SDK returns to the app by: the iOS client id reversed, as Google's
 * own configuration file calls it `REVERSED_CLIENT_ID`.
 */
export function googleUrlScheme(google: GoogleSignIn): string {
  return google.iosClientId.split('.').reverse().join('.')
}

/** The variant of a name, with what the build environment supplies. */
export function variantOf(name: string | undefined, env: BuildEnvironment): Variant {
  switch (name ?? 'dev') {
    case 'dev':
      // The end-to-end stack, reached on the device's own localhost: the iOS simulator shares
      // the Mac's, and an Android emulator is given it with `adb reverse`.
      return variant('TaskFest Dev', `${BUNDLE_ID}.dev`, 'http://localhost:3000', {
        label: 'Keycloak',
        issuer: 'http://localhost:8082/realms/taskfest',
        clientId: 'taskfest-app',
        scopes: [...OPENID_SCOPES, 'offline_access'],
      })
    case 'qa':
      // Google, and the test accounts beside it: the end-to-end runs sign in with those.
      return variant('TaskFest QA', `${BUNDLE_ID}.qa`, 'https://taskfest-qa.cloud.hilling.de', qaSignIn(env), googleSignIn(env, 'QA'))
    case 'prod':
      return variant('TaskFest', BUNDLE_ID, 'https://taskfest.cloud.hilling.de', null, googleSignIn(env, 'PROD'))
    default:
      throw new Error(`APP_VARIANT is ${name}; it must be dev, qa or prod.`)
  }
}

/**
 * The variant as the app reads it back from its configuration (`Main.tsx`). Expo's config loader
 * turns a null into an empty object on the way, and an empty object is truthy: a prod build
 * without sign-in offered a button for a provider of no name. So a provider counts only with the
 * fields it is made of.
 */
export function variantFromConfig(variant: Omit<Variant, 'signIn' | 'google'> & { signIn?: object | null; google?: object | null }): Variant {
  const signIn = variant.signIn && 'issuer' in variant.signIn ? (variant.signIn as SignIn) : null
  const google = variant.google && 'webClientId' in variant.google ? (variant.google as GoogleSignIn) : null
  return { ...variant, signIn, google }
}

/** Every variant as a build without extra environment would make it. */
export const variants: Record<VariantName, Variant> = {
  dev: variantOf('dev', {}),
  qa: variantOf('qa', {}),
  prod: variantOf('prod', {}),
}
