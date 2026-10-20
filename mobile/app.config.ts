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
      // Google's sign-in (#280). In every build, because the native module is linked in every build
      // and its pods only build with what the plugin adds to the Podfile. The plugin also registers
      // the URL scheme Google's iOS SDK returns to the app by, the iOS client id reversed; a build
      // without Google's client ids gets one that no Google client will ever use.
      [
        'react-native-nitro-google-signin',
        { iosUrlScheme: variant.google ? googleUrlScheme(variant.google) : 'com.googleusercontent.apps.taskfest-without-google' },
      ],
      // Attaching photos (#274): what iOS says when it asks for the camera and the library. The app
      // takes no videos, so it never asks for the microphone; Android's photo picker needs no
      // permission at all.
      [
        'expo-image-picker',
        {
          cameraPermission: 'TaskFest uses the camera to attach a photo you take to a task.',
          photosPermission: 'TaskFest opens your photos to attach one you choose to a task.',
          microphonePermission: false,
        },
      ],
      // Sharing into the app (#355): Android offers it for text and links, and for images and PDFs --
      // one, or several. A file of another type is not offered TaskFest at all. iOS needs a share
      // extension, an App Group and a release that keeps it signed: that is #356.
      [
        'expo-sharing',
        {
          ios: { enabled: false },
          android: {
            enabled: true,
            singleShareMimeTypes: ['text/plain', 'image/*', 'application/pdf'],
            multipleShareMimeTypes: ['image/*', 'application/pdf'],
          },
        },
      ],
    ],
    extra: { variant },
  }
}
