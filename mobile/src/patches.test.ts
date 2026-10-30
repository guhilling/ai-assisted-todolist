import { readFileSync } from 'node:fs'

/**
 * The patches `patch-package` applies to dependencies after every install (`patches/`), checked
 * as installed: a patch that no longer applies fails the install, and one that silently did not run
 * -- an install without scripts -- fails here.
 */
describe('expo-sharing on Android, as patched (#414)', () => {
  it('passes the page title Chrome sends as the subject on beside the link', () => {
    const parser = readFileSync(
      require.resolve('expo-sharing/android/src/main/java/expo/modules/sharing/dataParsers/SimpleShareIntentDataParser.kt'),
      'utf8',
    )

    expect(parser).toContain('intent.getStringExtra(Intent.EXTRA_SUBJECT)')
  })

  it('is built from its source, which the patch changes, rather than taken precompiled', () => {
    // Expo ships its modules for Android precompiled; the APK would otherwise never see the patch.
    const settings = JSON.parse(readFileSync(require.resolve('../package.json'), 'utf8'))

    expect(settings.expo.autolinking.android.buildFromSource).toContain('expo-sharing')
  })
})
