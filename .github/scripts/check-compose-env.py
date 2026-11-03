#!/usr/bin/env python3
"""
Fails when a Compose file gives a variable an empty default: `${X:-}` or `${X-}`.

Run it from anywhere:

    python3 .github/scripts/check-compose-env.py

Such a default does not leave the variable out; it sets it to nothing. The container stack passed
the Google client's id that way, so without a `.env` the backend received
TASKFEST_OIDC_GOOGLE_CLIENT_ID set but empty. Quarkus' `${TASKFEST_OIDC_GOOGLE_CLIENT_ID:...}`
falls back to its default only when the variable is missing, so the client id came out empty and
the backend refused to start, sign-in off or not (#511). A value that may be absent comes from an
optional `env_file` instead, which leaves the variable out when it is.
"""

import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent

# ${NAME:-} and ${NAME-}: a default, and nothing after it.
EMPTY_DEFAULT = re.compile(r"\$\{(\w+):?-\}")


def compose_files():
    """The Compose files git tracks, wherever they are."""
    listed = subprocess.run(
        ["git", "ls-files", "*compose*.yml", "*compose*.yaml"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout.split()
    return [ROOT / name for name in listed]


def empty_defaults(path):
    """Each empty default in a file, as (line number, variable)."""
    found = []
    for number, line in enumerate(path.read_text().splitlines(), start=1):
        found += [(number, name) for name in EMPTY_DEFAULT.findall(line)]
    return found


def main():
    failed = False
    for path in compose_files():
        for number, name in empty_defaults(path):
            failed = True
            print(f"{path.relative_to(ROOT)}:{number}: ${{{name}:-}} passes {name} set but empty; "
                  "leave it out when unset, with an optional env_file (#511)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
