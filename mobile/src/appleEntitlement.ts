/**
 * Keeping Sign in with Apple's entitlement out of a build that does not offer Apple (#281).
 *
 * Expo applies an installed module's config plugin to every build by itself, and
 * expo-apple-authentication's adds the entitlement whatever the build is told. An App ID without
 * the capability cannot be signed with it, so where the variant has no Apple, the app's own plugin
 * (`plugins/withoutAppleSignIn.ts`) takes it out again.
 */

/** The entitlement Sign in with Apple needs, as Apple names it. */
export const APPLE_SIGN_IN_ENTITLEMENT = 'com.apple.developer.applesignin'

/** The entitlements without Sign in with Apple's, of whatever shape the caller keeps them in. */
export function withoutAppleSignIn<T extends Record<string, unknown>>(entitlements: T): Omit<T, typeof APPLE_SIGN_IN_ENTITLEMENT> {
  const { [APPLE_SIGN_IN_ENTITLEMENT]: _removed, ...rest } = entitlements
  return rest
}
