#!/usr/bin/env bash
# Signs a built iOS app ad hoc -- with no certificate -- carrying the share extension's App Group
# (#356). The release archives unsigned, and the export signs with the entitlements it finds in the
# archive's signatures: unsigned, there are none, and the App Group the extension hands shares to
# the app through would be lost. Signed here first, the export keeps it.
#
#   sign-with-app-group.sh <App.app> <entitlements>
#
# The entitlements are the extension's, which hold the App Group alone, for the app as well: the
# app's own also hold push's aps-environment, which the notifications plugin writes, though the app
# sends no push and its App ID has no push (#277 adds it). Nested code first, since a signature
# covers what is inside. Mobile CI runs this on its simulator build, so a release finds it working.
set -euo pipefail

app="$1"
entitlements="$2"

if [[ -d "$app/Frameworks" ]]; then
  find "$app/Frameworks" -maxdepth 1 \( -name '*.framework' -o -name '*.dylib' \) -exec codesign --force --sign - {} \;
fi
for extension in "$app"/PlugIns/*.appex; do
  codesign --force --sign - --entitlements "$entitlements" "$extension"
done
codesign --force --sign - --entitlements "$entitlements" "$app"
codesign --verify --deep --strict "$app"
