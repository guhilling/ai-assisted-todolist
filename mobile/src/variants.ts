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

/** Everything that differs between the builds. */
export type Variant = {
  name: string
  bundleId: string
  scheme: string
  apiBaseUrl: string
  /** Null where no provider is available to the app yet. */
  signIn: SignIn | null
}

/** The variant names `APP_VARIANT` accepts. */
export type VariantName = 'dev' | 'qa' | 'prod'

/** Build-time values a variant may need; only qa's test accounts come from here. */
export type BuildEnvironment = Record<string, string | undefined>

const BUNDLE_ID = 'de.hilling.taskfest'

function variant(name: string, bundleId: string, apiBaseUrl: string, signIn: SignIn | null): Variant {
  return { name, bundleId, scheme: bundleId, apiBaseUrl, signIn }
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
      return variant('TaskFest QA', `${BUNDLE_ID}.qa`, 'https://taskfest-qa.cloud.hilling.de', qaSignIn(env))
    case 'prod':
      // Google sign-in comes with #280.
      return variant('TaskFest', BUNDLE_ID, 'https://taskfest.cloud.hilling.de', null)
    default:
      throw new Error(`APP_VARIANT is ${name}; it must be dev, qa or prod.`)
  }
}

/** Every variant as a build without extra environment would make it. */
export const variants: Record<VariantName, Variant> = {
  dev: variantOf('dev', {}),
  qa: variantOf('qa', {}),
  prod: variantOf('prod', {}),
}
