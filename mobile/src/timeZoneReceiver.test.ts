import type { AndroidConfig } from 'expo/config-plugins'
import { RECEIVER, declareTimeZoneReceiver } from './timeZoneReceiver'

/** An app's manifest with its main activity and nothing else, as `expo prebuild` starts it. */
function manifest(): AndroidConfig.Manifest.AndroidManifest {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      queries: [],
      application: [{ $: { 'android:name': '.MainApplication' }, activity: [{ $: { 'android:name': '.MainActivity' } }] }],
    },
  }
}

const receiversOf = (androidManifest: AndroidConfig.Manifest.AndroidManifest) =>
  androidManifest.manifest.application?.[0].receiver ?? []

describe('the receiver that moves reminders with the time zone (#479)', () => {
  it('listens for a change of time zone, and only to the system', () => {
    const [receiver] = receiversOf(declareTimeZoneReceiver(manifest()))

    expect(receiver.$['android:name']).toBe(RECEIVER)
    expect(receiver.$['android:exported']).toBe('false')
    expect(receiver['intent-filter']?.[0].action?.map((action) => action.$['android:name'])).toEqual([
      'android.intent.action.TIMEZONE_CHANGED',
    ])
  })

  it('is added once however often prebuild applies it', () => {
    expect(receiversOf(declareTimeZoneReceiver(declareTimeZoneReceiver(manifest())))).toHaveLength(1)
  })

  it('names the class the plugin copies into the build', () => {
    expect(RECEIVER).toBe('de.hilling.taskfest.reminders.TimeZoneChangedReceiver')
  })
})
