/**
 * What Android's share sheet says sharing to the app does (#355): the label of the shares
 * `expo-sharing`'s plugin offers the main activity for, which the share sheet shows beneath the
 * app's name.
 *
 * Here rather than in a plugin so that it is tested; `plugins/withShareLabel.ts` applies it.
 */

import type { AndroidConfig } from 'expo/config-plugins'

/** How `expo-sharing`'s plugin marks the intent filters it adds. */
const SHARING_GENERATED_TAG = 'expo-sharing-intent-filters'

/**
 * The manifest with every share the app is offered for labelled `label`.
 *
 * @throws Error when the manifest offers the app for no share -- better than a share sheet that
 *   shows the app's name alone again unnoticed
 */
export function withShareLabel(
  androidManifest: AndroidConfig.Manifest.AndroidManifest,
  label: string,
): AndroidConfig.Manifest.AndroidManifest {
  const shares = (androidManifest.manifest.application ?? [])
    .flatMap((application) => application.activity ?? [])
    .flatMap((activity) => activity['intent-filter'] ?? [])
    // The plugin's tag, and the label, are attributes Expo's type of an intent filter leaves out.
    .filter((filter) => (filter.$ as Record<string, string> | undefined)?.[SHARING_GENERATED_TAG] === 'true')
  if (!shares.length) {
    throw new Error('Android’s share sheet no longer offers TaskFest where it is given its label.')
  }
  for (const share of shares) {
    share.$ = { ...share.$, 'android:label': label } as typeof share.$
  }
  return androidManifest
}
