import type { AndroidConfig } from 'expo/config-plugins'
import { setAndroidIntentFilters } from 'expo-sharing/plugin/build/android/withAndroidIntentFilters'
import { parseIntentFilters } from 'expo-sharing/plugin/build/android/parseIntentFilters'
import { withShareLabel } from './shareLabel'

/** An app's manifest with its main activity and nothing else, as `expo prebuild` starts it. */
function manifest(): AndroidConfig.Manifest.AndroidManifest {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      queries: [],
      application: [
        {
          $: { 'android:name': '.MainApplication' },
          activity: [
            {
              $: { 'android:name': '.MainActivity' },
              'intent-filter': [
                { action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }], category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }] },
              ],
            },
          ],
        },
      ],
    },
  }
}

/** The manifest as `expo-sharing`'s plugin leaves it, offering the app for a text and for several images. */
function shared() {
  const config = { modResults: manifest() }
  setAndroidIntentFilters(config as never, [parseIntentFilters(['text/plain'], 'single'), parseIntentFilters(['image/*'], 'multiple')])
  return config.modResults
}

function filtersOf(androidManifest: AndroidConfig.Manifest.AndroidManifest) {
  return androidManifest.manifest.application?.[0].activity?.[0]['intent-filter'] as { $?: Record<string, string> }[]
}

describe('what Android’s share sheet says sharing to the app does (#355)', () => {
  it('is the share’s label, on every share the app is offered for', () => {
    const [launcher, single, multiple] = filtersOf(withShareLabel(shared(), 'Create Task (QA)'))

    expect(single.$?.['android:label']).toBe('Create Task (QA)')
    expect(multiple.$?.['android:label']).toBe('Create Task (QA)')
    expect(launcher.$?.['android:label']).toBeUndefined()
  })

  it('says so when expo-sharing no longer offers the app as it did', () => {
    expect(() => withShareLabel(manifest(), 'Create Task')).toThrow('Android’s share sheet no longer offers TaskFest where it is given its label.')
  })
})
