#!/usr/bin/env python3
"""
Fails when the iOS app's share extension (#356) is built or signed so that sharing cannot work.

Mobile CI checks the simulator build, which is not signed:

    python3 .github/scripts/check-share-extension.py built <App.app> <the build's share name>

and that it signs with the App Group, once signed ad hoc as the release signs it; the release
checks the .ipa it signed, before uploading it:

    python3 .github/scripts/check-share-extension.py signed <App.app or App.ipa>

expo-sharing's config plugin generates the extension; nothing else would notice if it went wrong.
Built, the extension must be a share extension, show the build's share name in the share sheet --
"Create Task (Dev)" in the dev build, where the plugin gives it the target's,
"expo-sharing-extension", which plugins/withShareExtensionName.ts replaces -- and use the App Group
group.<the app's bundle id>. Signed, the app and the extension must both carry that App Group: the
release archives unsigned and has the export sign, and a signature without it leaves the share in
a container the app cannot read (doc/mobile/distribution.md).
"""

import pathlib
import plistlib
import subprocess
import sys
import tempfile
import zipfile

EXTENSION = "PlugIns/expo-sharing-extension.appex"
APP_GROUPS = "com.apple.security.application-groups"


def built_problems(app: dict, extension, name: str) -> list:
    """What is wrong with the extension's Info.plist, given the app's; none when nothing is."""
    if extension is None:
        return [f"The app embeds no {EXTENSION}."]
    problems = []
    kind = extension.get("NSExtension", {}).get("NSExtensionPointIdentifier")
    if kind != "com.apple.share-services":
        problems.append(f"The extension is a {kind}, not a share extension.")
    shown = extension.get("CFBundleDisplayName")
    if shown != name:
        problems.append(f"The share sheet would say '{shown}', not '{name}'.")
    group = f"group.{app['CFBundleIdentifier']}"
    if extension.get("AppGroupId") != group:
        problems.append(f"The extension uses App Group '{extension.get('AppGroupId')}', not '{group}'.")
    return problems


def signed_problems(bundle_id: str, app: dict, extension) -> list:
    """What is wrong with the entitlements the app and the extension were signed with."""
    if extension is None:
        return [f"The app embeds no {EXTENSION}."]
    group = f"group.{bundle_id}"
    return [
        f"The {what} is signed without App Group {group}."
        for what, entitlements in (("app", app), ("share extension", extension))
        if group not in entitlements.get(APP_GROUPS, [])
    ]


def _info(bundle: pathlib.Path):
    plist = bundle / "Info.plist"
    return plistlib.loads(plist.read_bytes()) if plist.exists() else None


def _entitlements(bundle: pathlib.Path) -> dict:
    signed = subprocess.run(["codesign", "-d", "--entitlements", "-", "--xml", str(bundle)],
                            check=True, capture_output=True).stdout
    return plistlib.loads(signed) if signed.strip() else {}


def main(argv: list) -> int:
    if len(argv) == 4 and argv[1] == "built":
        app = pathlib.Path(argv[2])
        problems = built_problems(_info(app), _info(app / EXTENSION), argv[3])
    elif len(argv) == 3 and argv[1] == "signed":
        with tempfile.TemporaryDirectory() as unpacked:
            app = pathlib.Path(argv[2])
            if app.suffix == ".ipa":
                with zipfile.ZipFile(app) as ipa:
                    ipa.extractall(unpacked)
                app = next(pathlib.Path(unpacked, "Payload").glob("*.app"))
            extension = app / EXTENSION
            problems = signed_problems(_info(app)["CFBundleIdentifier"], _entitlements(app),
                                       _entitlements(extension) if extension.exists() else None)
    else:
        print(__doc__, file=sys.stderr)
        return 2
    for problem in problems:
        print(f"::error::{problem}")
    if not problems:
        print("The share extension is as it should be.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
