#!/usr/bin/env bash
# Shares into the iOS app through the real share sheet (#380): boots an iPhone simulator, installs
# the simulator build Mobile CI's ios job made and signed, puts a photo in Photos, and runs the flows
# in this folder, each from a TaskFest that has never run. Usage: run-on-simulator.sh <path to .app>
set -euo pipefail

app=$1
here=$(cd "$(dirname "$0")" && pwd)
out=${MAESTRO_OUTPUT:-maestro-output-ios}
mkdir -p "$out"

# The newest iOS runtime's first iPhone.
udid=$(xcrun simctl list devices available -j | python3 -c '
import json, sys
devices = json.load(sys.stdin)["devices"]
print(next(d["udid"] for runtime, ds in sorted(devices.items(), reverse=True) if "iOS" in runtime
           for d in ds if d["name"].startswith("iPhone")))')
xcrun simctl boot "$udid"
xcrun simctl bootstatus "$udid" -b
xcrun simctl install "$udid" "$app"

# A plain red square, made here rather than kept as a binary in the repository.
python3 - "$out/red.png" <<'PY'
import struct, sys, zlib
w = h = 64
raw = b"".join(b"\x00" + b"\xff\x40\x40" * w for _ in range(h))
chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
open(sys.argv[1], "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                              + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
PY
xcrun simctl addmedia "$udid" "$out/red.png"

status=0
for flow in share-photo share-link; do
  # Each share finds the app closed, as after a restart: the extension has to open it.
  xcrun simctl terminate "$udid" de.hilling.taskfest.dev 2>/dev/null || true
  maestro --device "$udid" test "$here/$flow.yaml" --test-output-dir "$out" \
    --format junit --output "maestro-ios-$flow.xml" || status=1
done
exit $status
