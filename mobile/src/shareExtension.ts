/**
 * The iOS share extension (#356), which `expo-sharing`'s config plugin generates: what it accepts,
 * and the name the share sheet shows for it.
 *
 * Here rather than in `app.config.ts` so that they are tested; `plugins/withShareExtensionName.ts`
 * applies the name.
 */

/**
 * What the extension is offered for: shares whose every item is an image, a PDF, a link -- not a
 * file's, which every file from the Files app also is -- or text. A Word file is not offered
 * TaskFest at all, as on Android. Apple's form for a rule that goes by type (`NSExtensionActivationRule`);
 * Mobile CI checks the one built into the extension against shares of each kind
 * (`.github/scripts/check-share-extension.swift`).
 */
export const SHARE_ACTIVATION_RULE = `SUBQUERY (
  extensionItems, $extensionItem,
  SUBQUERY (
    $extensionItem.attachments, $attachment,
    ANY $attachment.registeredTypeIdentifiers UTI-CONFORMS-TO "public.image"
    || ANY $attachment.registeredTypeIdentifiers UTI-CONFORMS-TO "com.adobe.pdf"
    || (ANY $attachment.registeredTypeIdentifiers UTI-CONFORMS-TO "public.url"
        AND NOT (ANY $attachment.registeredTypeIdentifiers UTI-CONFORMS-TO "public.file-url"))
    || ANY $attachment.registeredTypeIdentifiers UTI-CONFORMS-TO "public.plain-text"
  ).@count == $extensionItem.attachments.@count
).@count == 1`

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
