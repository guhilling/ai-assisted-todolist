import type { ConfigContext, ExpoConfig } from 'expo/config'
import { variantOf } from './src/variants.ts'

/**
 * The app's configuration, made per build from the variant `APP_VARIANT` names (#267).
 *
 * `ios/` and `android/` are generated from this by `expo prebuild` and never committed
 * (doc/decisions/mobile-app.md), so everything native about the app is said here.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = variantOf(process.env.APP_VARIANT, process.env)
  const dev = variant.bundleId.endsWith('.dev')
  return {
    ...config,
    name: variant.name,
    slug: 'taskfest',
    scheme: variant.scheme,
    // The release tag sets the version (doc/releasing.md); a build from a branch is 0.0.0.
    version: process.env.TASKFEST_VERSION ?? '0.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: variant.bundleId,
      supportsTablet: true,
      config: { usesNonExemptEncryption: false },
      // The dev build's plain HTTP to localhost; App Transport Security allows nothing else.
      ...(dev ? { infoPlist: { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } } } : {}),
    },
    android: {
      package: variant.bundleId,
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      'expo-localization',
      'expo-web-browser',
      [
        'expo-build-properties',
        // Only the dev build talks plain HTTP, to the end-to-end stack on localhost.
        dev ? { android: { usesCleartextTraffic: true }, ios: {} } : { android: {}, ios: {} },
      ],
    ],
    experiments: { typedRoutes: true },
    extra: { variant },
  }
}
