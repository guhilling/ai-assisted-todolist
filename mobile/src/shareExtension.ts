/**
 * The iOS share extension (#356), which `expo-sharing`'s config plugin generates: what it accepts,
 * the name the share sheet shows for it, and where it leaves a shared file for the app.
 *
 * Here rather than in `app.config.ts` so that they are tested; `plugins/withShareExtensionName.ts`
 * applies the name and the folder.
 */

/**
 * What the extension is offered for: shares whose every item is an image, a PDF, a link or text --
 * a link or text that is not a file's, which every file from the Files app also is, so a text file
 * is not offered. Nor is a Word file, as on Android. Every item, not one: an app sharing several
 * things hands each as an item of its own. Apple's form for a rule that goes by type
 * (`NSExtensionActivationRule`); Mobile CI checks the one built into the extension against shares
 * of each kind (`.github/scripts/check-share-activation.swift`).
 */
export const SHARE_ACTIVATION_RULE = `SUBQUERY (
  extensionItems, $extensionItem,
  SUBQUERY (
    $extensionItem.attachments, $attachment,
    ANY $attachment.registeredTypeIdentifiers UTI-CONFORMS-TO "public.image"
    || ANY $attachment.registeredTypeIdentifiers UTI-CONFORMS-TO "com.adobe.pdf"
    || ((ANY $attachment.registeredTypeIdentifiers UTI-CONFORMS-TO "public.url"
         || ANY $attachment.registeredTypeIdentifiers UTI-CONFORMS-TO "public.plain-text")
        AND NOT (ANY $attachment.registeredTypeIdentifiers UTI-CONFORMS-TO "public.file-url"))
  ).@count == $extensionItem.attachments.@count
).@count == extensionItems.@count`

/**
 * The extension's Info.plist, as the plugin writes it, with the name the share sheet shows: the
 * app's, where the plugin gives the target's, "expo-sharing-extension".
 *
 * @throws Error when the plugin no longer writes a name to replace -- better than a share sheet
 *   that says "expo-sharing-extension" again unnoticed
 */
export function withDisplayName(infoPlist: string, name: string): string {
  const key = /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/
  if (!key.test(infoPlist)) {
    throw new Error('The share extension’s Info.plist has no CFBundleDisplayName to set.')
  }
  const escaped = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return infoPlist.replace(key, (_match, start: string, end: string) => `${start}${escaped}${end}`)
}

/**
 * The extension's code, as the plugin copies it from `expo-sharing`, with every shared file copied
 * into a folder of its own in the App Group. The template copies it to the top of the App Group
 * under its own name, so of two files called "Scan.pdf", from two folders, only the second would
 * reach the app. A file the template saves under a random name already has one of its own, and
 * stays where it is.
 *
 * @throws Error when the template no longer copies a file as it did -- better than files lost
 *   unnoticed again
 */
export function withFolderPerFile(swift: string): string {
  const copied = `    let fileName = url.lastPathComponent.isEmpty ? UUID().uuidString : url.lastPathComponent
    let destinationURL = containerURL.appendingPathComponent(fileName)
`
  if (swift.split(copied).length !== 2) {
    throw new Error('The share extension no longer copies a shared file where TaskFest gives it a folder of its own.')
  }
  return swift.replace(
    copied,
    `    let fileName = url.lastPathComponent.isEmpty ? UUID().uuidString : url.lastPathComponent
    let folder = containerURL.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let destinationURL = folder.appendingPathComponent(fileName)
`,
  )
}
