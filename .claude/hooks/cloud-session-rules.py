#!/usr/bin/env python3
"""
Puts the shared rules into a cloud session's context (#458), where the plugin that brings them
locally is never loaded.

The `conventions` plugin of dev-conventions prints its rules.md at every session start, but a
cloud session on claude.ai/code installs no plugin a repository declares. The hooks in
.claude/settings.json do run there, so this one, a SessionStart hook, fetches rules.md at the tag
that file pins and prints it; a SessionStart hook's output becomes part of the context. It does
nothing outside a cloud session, where the plugin already did it. The tag is read from the
settings file, so that Renovate's pin stays the only one.

A failed fetch prints a warning instead, so the session notices that the rules are missing.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import json
import os
import pathlib
import sys
import urllib.request

SETTINGS = pathlib.Path(__file__).resolve().parents[1] / "settings.json"
RULES = "https://raw.githubusercontent.com/{repo}/{ref}/plugins/conventions/rules.md"


def rules_url(settings):
    """The address of rules.md at the repository and tag the settings file pins."""
    source = json.loads(settings.read_text())["extraKnownMarketplaces"]["dev-conventions"]["source"]
    return RULES.format(repo=source["repo"], ref=source["ref"])


def main():
    if os.environ.get("CLAUDE_CODE_REMOTE") != "true":
        return 0
    url = rules_url(SETTINGS)
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            print(response.read().decode())
    except OSError as error:
        print(f"WARNING: the shared rules of this repository could not be fetched from {url} "
              f"({error}). Tell Gunnar, and read them there before working.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
