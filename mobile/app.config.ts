import type { ConfigContext, ExpoConfig } from 'expo/config'
import { releaseOf } from './src/release.ts'
import { googleUrlScheme, variantOf } from './src/variants.ts'

/**
 * The app's configuration, made per build from the variant `APP_VARIANT` names (#267).
 *
 * `ios/` and `android/` are generated from this by `expo prebuild` and never committed
 * (doc/decisions/mobile-app.md), so everything native about the app is said here.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = variantOf(process.env.APP_VARIANT, process.env)
  const dev = variant.bundleId.endsWith('.dev')
  const release = releaseOf(process.env)
  return {
    ...config,
    name: variant.name,
    slug: 'taskfest',
    scheme: variant.scheme,
    // The release tag sets the version (doc/releasing.md), the release run the build number
    // (doc/mobile/distribution.md); a build from a branch is 0.0.0, build 1.
    version: release.version,
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: variant.bundleId,
      buildNumber: String(release.buildNumber),
      // Only a signed build needs the team; the simulator builds sign nothing.
      ...(process.env.APPLE_TEAM_ID ? { appleTeamId: process.env.APPLE_TEAM_ID } : {}),
      supportsTablet: true,
      config: { usesNonExemptEncryption: false },
      // The dev build's plain HTTP to localhost; App Transport Security allows nothing else.
      ...(dev ? { infoPlist: { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } } } : {}),
    },
    android: {
      package: variant.bundleId,
      versionCode: release.buildNumber,
      adaptiveIcon: {
        backgroundColor: '#E9F5E1',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    plugins: [
      'expo-secure-store',
      'expo-localization',
      'expo-web-browser',
      // The due-day reminders (#273): Android shows the mark's single-colour form in the status bar.
      ['expo-notifications', { icon: './assets/notification-icon.png', color: '#7fae1c' }],
      [
        'expo-build-properties',
        // Only the dev build talks plain HTTP, to the end-to-end stack on localhost.
        dev ? { android: { usesCleartextTraffic: true }, ios: {} } : { android: {}, ios: {} },
      ],
      // Google's sign-in (#280), only in a build that knows its client ids: the plugin refuses to
      // run without the iOS one, whose reversed form is the URL scheme Google returns to the app by.
      ...(variant.google ? [['react-native-nitro-google-signin', { iosUrlScheme: googleUrlScheme(variant.google) }] as [string, object]] : []),
    ],
    extra: { variant },
  }
}
