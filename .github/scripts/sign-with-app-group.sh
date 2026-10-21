#!/usr/bin/env bash
# Signs a built iOS app ad hoc -- with no certificate -- carrying the share extension's App Group
# (#356). The release archives unsigned, and the export signs with the entitlements it finds in the
# archive's signatures: unsigned, there are none, and the App Group the extension hands shares to
# the app through would be lost. Signed here first, the export keeps it.
#
#   sign-with-app-group.sh <App.app> <the app's entitlements> <the extension's entitlements>
#
# Each with its own entitlements, as the project generates them, with one left out: push's
# aps-environment, which the notifications plugin writes into the app's, though the app sends no
# push and its App ID has no push (#277 adds it). Anything else a plugin adds stays, and the export
# fails if the App ID does not allow it, rather than leaving it out unnoticed. Nested code first,
# since a signature covers what is inside. Mobile CI runs this on its simulator build, so a release
# finds it working.
set -euo pipefail

app="$1"
app_entitlements="$2"
extension_entitlements="$3"

without_push=$(mktemp)
trap 'rm -f "$without_push"' EXIT
cp "$app_entitlements" "$without_push"
plutil -remove aps-environment "$without_push" >/dev/null 2>&1 || true

if [[ -d "$app/Frameworks" ]]; then
  find "$app/Frameworks" -maxdepth 1 \( -name '*.framework' -o -name '*.dylib' \) -exec codesign --force --sign - {} \;
fi
for extension in "$app"/PlugIns/*.appex; do
  codesign --force --sign - --entitlements "$extension_entitlements" "$extension"
done
codesign --force --sign - --entitlements "$without_push" "$app"
codesign --verify --deep --strict "$app"
