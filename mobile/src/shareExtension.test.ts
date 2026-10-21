import { readFileSync } from 'node:fs'
import { SHARE_ACTIVATION_RULE, withDisplayName, withFolderPerFile } from './shareExtension'

/** The iOS share extension (#356), as expo-sharing's plugin writes it and the app's plugin names it. */
const written = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
  <dict>
    <key>AppGroupId</key>
    <string>group.de.hilling.taskfest.qa</string>
    <key>CFBundleDisplayName</key>
    <string>$(PRODUCT_NAME)</string>
    <key>CFBundleName</key>
    <string>$(PRODUCT_NAME)</string>
  </dict>
</plist>`

describe('the share extension’s name in the share sheet (#356)', () => {
  it('is the app’s, not the target’s', () => {
    const named = withDisplayName(written, 'TaskFest QA')

    expect(named).toContain('<key>CFBundleDisplayName</key>\n    <string>TaskFest QA</string>')
    expect(named).toContain('<key>CFBundleName</key>\n    <string>$(PRODUCT_NAME)</string>')
  })

  it('is written as XML writes it', () => {
    expect(withDisplayName(written, 'Tasks & <more>')).toContain('<string>Tasks &amp; &lt;more&gt;</string>')
  })

  it('says so when the plugin no longer writes the name as it did', () => {
    expect(() => withDisplayName('<plist version="1.0"><dict></dict></plist>', 'TaskFest')).toThrow(
      'The share extension’s Info.plist has no CFBundleDisplayName to set.',
    )
  })
})

describe('what the share extension accepts (#356)', () => {
  it('is images, PDFs, links and text, in every item: Mobile CI checks the rule against shares', () => {
    for (const type of ['public.image', 'com.adobe.pdf', 'public.url', 'public.plain-text']) {
      expect(SHARE_ACTIVATION_RULE).toContain(`UTI-CONFORMS-TO "${type}"`)
    }
  })
})

describe('where the share extension leaves a shared file for the app (#356)', () => {
  const template = readFileSync(require.resolve('expo-sharing/plugin/template-files/ios/ShareIntoViewController.swift'), 'utf8')

  it('is a folder of its own, so two files of one name do not overwrite each other', () => {
    const changed = withFolderPerFile(template)

    expect(changed).toContain('let folder = containerURL.appendingPathComponent(UUID().uuidString, isDirectory: true)')
    expect(changed).toContain('let destinationURL = folder.appendingPathComponent(fileName)')
    expect(changed.match(/let destinationURL = containerURL\.appendingPathComponent\(fileName\)/g)).toHaveLength(1)
  })

  it('says so when expo-sharing no longer copies a file as it did', () => {
    expect(() => withFolderPerFile('class ShareIntoViewController {}')).toThrow(
      'The share extension no longer copies a shared file where TaskFest gives it a folder of its own.',
    )
  })
})
