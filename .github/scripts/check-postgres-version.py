#!/usr/bin/env python3
"""
Fails when the project pins more than one PostgreSQL version.

Run it from anywhere:

    python3 .github/scripts/check-postgres-version.py

The version is pinned in places that have no reason to know about each other: Dev Services for
`%dev` and for `%test` in the backend's application.properties, the image in each of the two
Compose stacks, and the RDS engine's major version in the OpenTofu module. They drifted -- dev and test ran 17 while both Compose stacks ran 18 -- and
nothing noticed until somebody went looking for which version RDS should run.

That drift is not cosmetic. `task_state` and `task_importance` are native PostgreSQL enum types,
and the tests that pin their behaviour run against whatever Dev Services starts. Testing on one
major and deploying on another means the tests are evidence about the wrong database.

The rule is therefore: every pin agrees, and the build says so.
"""

import collections
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent

# `postgres:18-alpine` and `postgres:18`, but not the host:port in a JDBC URL
# (`jdbc:postgresql://postgres:5432/taskfest`), which the lookbehind excludes by refusing a
# match preceded by a slash. The port check is the belt to that braces: a PostgreSQL major is
# never four digits.
PIN = re.compile(r"(?<![/\w])postgres:(\d+)(?:-[a-z0-9.]+)?")

# The RDS engine is not an image, so it has its own spelling: the `db_engine_major` local in the
# OpenTofu module. Matched by name, because a bare version string in HCL could be anything.
RDS_PIN = re.compile(r'\bdb_engine_major\s*=\s*"(\d+)"')


def tracked_text_files():
    """Only files git tracks, so build output and node_modules cannot contribute a pin."""
    listing = subprocess.run(
        ["git", "-C", str(ROOT), "ls-files"],
        capture_output=True, text=True, check=True,
    )
    for name in listing.stdout.splitlines():
        path = ROOT / name
        if path.suffix in {".properties", ".yml", ".yaml", ".md", ".java", ".ts", ".tsx", ".tf"}:
            yield path


def main():
    found = collections.defaultdict(list)

    for path in tracked_text_files():
        try:
            text = path.read_text()
        except (UnicodeDecodeError, OSError):
            continue
        for number, line in enumerate(text.splitlines(), 1):
            for match in [*PIN.finditer(line), *RDS_PIN.finditer(line)]:
                version = int(match.group(1))
                if version >= 1000:
                    continue
                found[version].append(f"{path.relative_to(ROOT)}:{number}")

    if not found:
        print("No PostgreSQL version pin found at all, which is itself suspicious.", file=sys.stderr)
        return 1

    if len(found) > 1:
        print("The project pins more than one PostgreSQL version:\n", file=sys.stderr)
        for version in sorted(found):
            print(f"  postgres:{version}", file=sys.stderr)
            for where in found[version]:
                print(f"      {where}", file=sys.stderr)
        print(
            "\nThe tests run against whichever Dev Services starts, so a split means the tests "
            "are\nevidence about a different database from the one that is deployed.",
            file=sys.stderr,
        )
        return 1

    version = next(iter(found))
    print(f"postgres:{version} in all {len(found[version])} places that pin it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
