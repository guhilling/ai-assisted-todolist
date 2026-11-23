import configPlugins, { type ConfigPlugin } from 'expo/config-plugins'
import { withoutAppleSignIn as without } from '../src/appleEntitlement.ts'

/**
 * Takes Sign in with Apple's entitlement out of a build whose variant does not offer Apple (#281):
 * expo-apple-authentication's plugin, which Expo applies by itself, adds it to every build, and an
 * App ID without the capability cannot be signed with it (`src/appleEntitlement.ts`).
 *
 * Its change must run after that plugin's, so it is applied, like `withShareLabel`, to the config
 * `app.config.ts` returns.
 */
export const withoutAppleSignIn: ConfigPlugin = (config) =>
  configPlugins.withEntitlementsPlist(config, (config) => {
    config.modResults = without(config.modResults)
    return config
  })
