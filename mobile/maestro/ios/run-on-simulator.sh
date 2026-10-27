#!/usr/bin/env bash
# Shares into the iOS app through the real share sheet (#380): boots an iPhone simulator, installs
# the simulator build Mobile CI's ios job made and signed, and runs the flow in this folder, which
# shares one of the photos every simulator comes with. Usage: run-on-simulator.sh <path to .app>
set -euo pipefail

app=$1
here=$(cd "$(dirname "$0")" && pwd)
out=${MAESTRO_OUTPUT:-maestro-output-ios}
mkdir -p "$out"

# The first iPhone of the newest iOS runtime, by its version's numbers: as text, iOS-26-2 would come
# after iOS-26-10.
udid=$(xcrun simctl list devices available -j | python3 -c '
import json, re, sys
devices = json.load(sys.stdin)["devices"]
def version(runtime):
    return tuple(int(n) for n in re.findall(r"\d+", runtime.rsplit("iOS", 1)[-1]))
ios = sorted((r for r in devices if ".iOS-" in r), key=version, reverse=True)
print(next(d["udid"] for r in ios for d in devices[r] if d["name"].startswith("iPhone")))')
# Boots it, if need be, and waits until it has.
xcrun simctl bootstatus "$udid" -b
xcrun simctl install "$udid" "$app"

status=0
# A link shared from Safari is not among them yet: see #380.
for flow in share-photo; do
  # Each share finds the app closed, as after a restart: the extension has to open it.
  xcrun simctl terminate "$udid" de.hilling.taskfest.dev 2>/dev/null || true
  maestro --device "$udid" test "$here/$flow.yaml" --test-output-dir "$out" \
    --format junit --output "maestro-ios-$flow.xml" || status=1
done
exit $status
