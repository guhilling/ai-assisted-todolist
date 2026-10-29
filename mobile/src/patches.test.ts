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
})
