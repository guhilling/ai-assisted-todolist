"""Throwaway (#380): logs what the share extension is handed, with TFDIAG in front."""
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
def rep(a, b):
    global t
    assert a in t, a
    t = t.replace(a, b, 1)
rep("  private func parseProvider(_ provider: NSItemProvider) async -> SharePayload? {\n",
    "  private func parseProvider(_ provider: NSItemProvider) async -> SharePayload? {\n"
    "    NSLog(\"TFDIAG provider types: %@\", provider.registeredTypeIdentifiers.joined(separator: \",\"))\n")
rep("      provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, _ in\n",
    "      provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, error in\n"
    "        NSLog(\"TFDIAG url item type: %@ value: %@ error: %@\", String(describing: Swift.type(of: item)), String(describing: item), String(describing: error))\n")
rep("      provider.loadItem(forTypeIdentifier: UTType.text.identifier, options: nil) { item, _ in\n",
    "      provider.loadItem(forTypeIdentifier: UTType.text.identifier, options: nil) { item, error in\n"
    "        NSLog(\"TFDIAG text item type: %@ error: %@\", String(describing: Swift.type(of: item)), String(describing: error))\n")
rep("  private func handleShare() {\n",
    "  private func handleShare() {\n    NSLog(\"TFDIAG handleShare, items: %@\", String(describing: extensionContext?.inputItems))\n")
rep("      if !payload.isEmpty {\n",
    "      NSLog(\"TFDIAG payload count: %d\", payload.count)\n      if !payload.isEmpty {\n")
rep("  // MARK: - Lifecycle\n",
    "  // MARK: - Lifecycle\n\n"
    "  override func viewDidLoad() {\n    NSLog(\"TFDIAG viewDidLoad\")\n    super.viewDidLoad()\n  }\n\n")
rep("    openURL(url)\n",
    "    NSLog(\"TFDIAG opening %@\", url.absoluteString)\n    openURL(url)\n")
rep("      if let application = responder as? UIApplication {\n",
    "      NSLog(\"TFDIAG responder %@\", String(describing: Swift.type(of: responder!)))\n"
    "      if let application = responder as? UIApplication {\n        NSLog(\"TFDIAG found UIApplication\")\n")
p.write_text(t)
print("patched", p)
