/**
 * The Android receiver that moves the floating reminders when the phone's time zone changes (#479),
 * as the app's manifest declares it.
 *
 * Every Android alarm is a fixed moment, so without it "pills at 08:00" would fire at the old
 * zone's 08:00 after a flight, until the app is next opened. The receiver itself is Kotlin,
 * `plugins/android/TimeZoneChangedReceiver.kt`, which needs no JavaScript runtime: the app may not
 * be running. Here rather than in the plugin so that it is tested; `plugins/withTimeZoneReceiver.ts`
 * applies it and copies the class in.
 */

import type { AndroidConfig } from 'expo/config-plugins'

/** The receiver's class, as the Kotlin file declares it. */
export const RECEIVER = 'de.hilling.taskfest.reminders.TimeZoneChangedReceiver'

/**
 * The manifest with the receiver, once. Not exported: only the system sends a change of time zone,
 * which is on Android's list of implicit broadcasts an app may still receive from its manifest.
 */
export function withTimeZoneReceiver(
  androidManifest: AndroidConfig.Manifest.AndroidManifest,
): AndroidConfig.Manifest.AndroidManifest {
  for (const application of androidManifest.manifest.application ?? []) {
    const receivers = application.receiver ?? []
    if (!receivers.some((receiver) => receiver.$['android:name'] === RECEIVER)) {
      receivers.push({
        $: { 'android:name': RECEIVER, 'android:exported': 'false' },
        'intent-filter': [{ action: [{ $: { 'android:name': 'android.intent.action.TIMEZONE_CHANGED' } }] }],
      })
    }
    application.receiver = receivers
  }
  return androidManifest
}
