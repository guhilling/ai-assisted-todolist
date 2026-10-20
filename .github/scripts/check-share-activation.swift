// Fails when the iOS share extension (#356) would be offered for the wrong shares.
//
//     swift .github/scripts/check-share-activation.swift <the extension's Info.plist>
//
// The rule that decides it is an NSPredicate in the extension's Info.plist
// (NSExtensionActivationRule, from mobile/src/shareExtension.ts). iOS evaluates it against what is
// being shared, by type: a mistake in it is no error anywhere, only TaskFest missing from the share
// sheet, or offered a Word file. Mobile CI evaluates the rule as built against shares of each kind,
// with Foundation's own type conformance, on macOS.

import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 2,
  let info = NSDictionary(contentsOfFile: arguments[1]),
  let attributes = (info["NSExtension"] as? NSDictionary)?["NSExtensionAttributes"] as? NSDictionary,
  let rule = attributes["NSExtensionActivationRule"] as? String
else {
  print("::error::No activation rule as a predicate in \(arguments.dropFirst().first ?? "the Info.plist")")
  exit(2)
}
let predicate = NSPredicate(format: rule)

/// A share as iOS hands it to the rule: one item, its attachments' type identifiers.
func share(_ attachments: [[String]]) -> NSDictionary {
  ["extensionItems": [["attachments": attachments.map { ["registeredTypeIdentifiers": $0] }]]]
}

let shares: [(String, [[String]], Bool)] = [
  ("a photo", [["public.heic", "public.jpeg"]], true),
  ("two photos", [["public.jpeg"], ["public.png"]], true),
  ("a PDF from Files", [["com.adobe.pdf", "public.file-url"]], true),
  ("a page from Safari", [["public.url"], ["public.plain-text"]], true),
  ("a link", [["public.url"]], true),
  ("text from Notes", [["public.utf8-plain-text"]], true),
  ("a Word file", [["org.openxmlformats.wordprocessingml.document"]], false),
  ("a Word file from Files", [["org.openxmlformats.wordprocessingml.document", "public.file-url"]], false),
  ("a photo and a Word file", [["public.jpeg"], ["org.openxmlformats.wordprocessingml.document"]], false),
  ("a video", [["public.mpeg-4"]], false),
]
var wrong = 0
for (what, attachments, offered) in shares {
  let result = predicate.evaluate(with: share(attachments))
  if result == offered {
    print("\(what): \(offered ? "offered" : "not offered"), as it should be")
  } else {
    print("::error::\(what): \(result ? "offered" : "not offered"), but should \(offered ? "be" : "not be")")
    wrong += 1
  }
}
exit(wrong == 0 ? 0 : 1)
