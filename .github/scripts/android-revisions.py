#!/usr/bin/env python3
"""
Prints the revisions sdkmanager would install for Android SDK packages, read from Google's package
index rather than by installing them (#302).

Run by mobile/maestro/emulator-cache.sh:

    python3 .github/scripts/android-revisions.py emulator "system-images;android-34;google_apis;x86_64"

prints one revision per package, in order (`37.2.12`, `14`). An emulator snapshot loads only into
the emulator version and system image that saved it, and the emulator action always installs the
newest of both, so the cache's tag names these. "Newest" is sdkmanager's on its stable channel,
`--channel=0`, which is what the action asks for: the highest revision among the packages whose
channel is channel-0, or that name none.
"""

import sys
import urllib.request
import xml.etree.ElementTree as ET

REPOSITORY = "https://dl.google.com/android/repository"
STABLE = "channel-0"


def index_url(path):
    """The index that lists a package: a system image's is its tag's own."""
    if path.startswith("system-images;"):
        tag = path.split(";")[2]
        return f"{REPOSITORY}/sys-img/{tag}/sys-img2-3.xml"
    return f"{REPOSITORY}/repository2-3.xml"


def newest(index, path):
    """The highest stable revision of the package at `path` in an index's XML, as text."""
    found = []
    for package in ET.fromstring(index).iter("remotePackage"):
        if package.get("path") != path:
            continue
        channel = package.find("channelRef")
        if channel is not None and channel.get("ref") != STABLE:
            continue
        parts = [int(part.text) for part in package.find("revision")]
        found.append(parts)
    if not found:
        raise LookupError(f"{path} has no stable revision in the index")
    return ".".join(str(part) for part in max(found))


def main(paths):
    for path in paths:
        with urllib.request.urlopen(index_url(path), timeout=30) as response:
            print(newest(response.read(), path))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
