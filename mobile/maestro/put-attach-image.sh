#!/usr/bin/env bash
# Puts an image in the emulator's Downloads for the attach flows' file picker to offer (#274, #278).
# Generated here rather than kept in the repository: a few lines of Python make a valid PNG.
# Android's media store is told of it, which the picker's Downloads go by.
set -euo pipefail

# Made in a directory of its own, not wherever the caller stands -- the repository's root, say.
image="$(mktemp -d)/attach-me.png"
trap 'rm -rf "$(dirname "$image")"' EXIT
IMAGE="$image" python3 - <<'PY'
import os
import struct, zlib
w, h = 320, 200
rows = b''.join(b'\x00' + b''.join(bytes([x * 255 // w, y * 255 // h, 160]) for x in range(w)) for y in range(h))
def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')
open(os.environ['IMAGE'], 'wb').write(png)
PY
adb push "$image" /sdcard/Download/attach-me.png
adb shell content call --uri content://media --method scan_volume --arg external_primary >/dev/null || true
