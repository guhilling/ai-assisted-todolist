#!/usr/bin/env python3
"""
Fails when a file in the repository names a documentation page that does not exist.

Run it from anywhere:

    python3 .github/scripts/check-doc-references.py

The site build already fails on a dead link between pages. What it cannot see is everything
else that points into `doc/`: a Javadoc saying "see {@code doc/decisions/authentication.md}", an
OpenTofu comment, a CLAUDE.md, a workflow. Those are prose, not links, so nothing resolves them,
and when the long documents were split into chapters 47 of them had to move at once. This makes
a missed one a failed build instead of a reader's dead end.

A reference is `doc/<path>.md`, or `doc/<chapter>/` for a chapter as a whole. `doc/api/` holds
generated files, not documentation, and is left alone. Only files git tracks are read, so build
output and node_modules cannot contribute.
"""

import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent

# Preceded by nothing that would make it part of a longer path (`backend/doc/...`), then either a
# .md file or a chapter directory with its trailing slash.
REFERENCE = re.compile(r"(?<![\w./-])(doc/(?:[a-z0-9-]+/)*(?:[a-z0-9-]+\.md|[a-z0-9-]+/))")


def references(text):
    """Every documentation path a text names, in order."""
    return [ref for ref in REFERENCE.findall(text) if not ref.startswith("doc/api/")]


def dead(found, exists):
    """The references among `found` whose target does not exist, according to `exists`."""
    return [ref for ref in found if not exists(ref.rstrip("/"))]


def tracked_files():
    listing = subprocess.run(["git", "-C", str(ROOT), "ls-files"],
                             capture_output=True, text=True, check=True)
    return [ROOT / name for name in listing.stdout.splitlines()]


def main():
    exists = lambda ref: (ROOT / ref).exists()
    problems = []
    for path in tracked_files():
        try:
            text = path.read_text()
        except (UnicodeDecodeError, OSError):
            continue
        for number, line in enumerate(text.splitlines(), 1):
            for ref in dead(references(line), exists):
                problems.append(f"{path.relative_to(ROOT)}:{number}: {ref}")

    if problems:
        print("These name documentation that does not exist:\n", file=sys.stderr)
        print("\n".join(f"  {p}" for p in problems), file=sys.stderr)
        print("\nPoint them at the page the text is about; doc/README.md lists the chapters.",
              file=sys.stderr)
        return 1
    print("every reference to doc/ names a page that exists")
    return 0


if __name__ == "__main__":
    sys.exit(main())
