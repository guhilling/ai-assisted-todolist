#!/usr/bin/env python3
"""
Decides the version of the next release from the API, as doc/releasing.md says it must be (#297).

Run by cut-release.yml, in two steps around oasdiff:

    git tag --list 'v*' | python3 .github/scripts/release-version.py latest
    python3 .github/scripts/release-version.py decide --bump auto --latest v1.4.2 --changes changes.json

`latest` prints the newest release's tag: the highest vX.Y.Z, pre-releases (`-rc.1`) aside.
`decide` reads oasdiff's `changelog --format json` between that release's API and main's, and
from 1.0.0 on lets it decide the step:

- an error, a change an app built for the release cannot cope with  -> major
- any other change: an addition, or a warning such as a new enum value  -> minor
- no change                                                             -> patch

A larger step than that may be asked for, a smaller one is refused. Under 0.x a release is a minor,
as every one so far was, and 1.0.0 is not this script's to give: it is released by hand.

`decide` writes its reasons to GITHUB_STEP_SUMMARY and the version to GITHUB_OUTPUT, both set by
Actions, and to stdout when they are not set; it exits 1 when it refuses.
"""

import argparse
import dataclasses
import json
import os
import re
import sys

STEPS = ("patch", "minor", "major")
TAG = re.compile(r"v(\d+)\.(\d+)\.(\d+)")
# oasdiff's levels: 1 information, 2 warning, 3 error -- what Backend CI's `--fail-on ERR` fails on.
ERROR = 3
# Says the document's info.version did not change with a breaking change. main's is always
# 1.0.0-SNAPSHOT (doc/releasing.md), so this is no news about the API itself.
NOT_ABOUT_THE_API = {"api-version-not-bumped"}


@dataclasses.dataclass
class Decision:
    """The next release's version, or None when the step asked for is refused, and why."""
    version: str | None
    summary: str


def latest_release(tags):
    """The highest final release among the tags, as (major, minor, patch), or None."""
    versions = [tuple(int(part) for part in match.groups())
                for match in (TAG.fullmatch(tag.strip()) for tag in tags) if match]
    return max(versions, default=None)


def required_step(changes):
    """The step the API's changes need, from oasdiff's changelog."""
    about_the_api = [change for change in changes if change["id"] not in NOT_ABOUT_THE_API]
    if any(change["level"] >= ERROR for change in about_the_api):
        return "major"
    return "minor" if about_the_api else "patch"


def raise_by(version, step):
    major, minor, patch = version
    if step == "major":
        return f"{major + 1}.0.0"
    if step == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def decide(bump, latest, changes):
    """The next version after `latest` for the step asked for (`auto` or one of STEPS)."""
    latest_tag = "v" + ".".join(str(part) for part in latest)
    needed = required_step(changes)
    reasons = _reasons(changes, latest_tag)

    if latest[0] == 0:
        if bump == "major":
            return Decision(None, _refusal(
                "1.0.0 is released by hand, together, not by this workflow; under 0.x ask for "
                "`auto`, `minor` or `patch` (doc/releasing.md).", reasons))
        step = "minor" if bump == "auto" else bump
        why = (f"Under 0.x a release is a **{step}**: the API decides from 1.0.0 on. "
               f"By the API's rule it would have been a {needed}.")
    elif bump == "auto":
        step = needed
        why = f"The API decides: a **{step}**."
    elif STEPS.index(bump) < STEPS.index(needed):
        return Decision(None, _refusal(
            f"A {bump} was asked for, but the API needs a **{needed}** (doc/releasing.md).",
            reasons + (_MAJOR_STEPS if needed == "major" else "")))
    else:
        step = bump
        why = f"A **{step}** was asked for; the API alone would have needed a {needed}."

    version = raise_by(latest, step)
    summary = f"## Release {version}\n\n{why}\n\n{reasons}"
    if step == "major" and latest[0] > 0:
        summary += _MAJOR_STEPS
    return Decision(version, summary)


_MAJOR_STEPS = """
A major also needs, in the pull request that broke the API (doc/releasing.md):

1. `doc/api/oldest-supported-release` moved forward to the oldest release still served;
2. `taskfest.minimum-app-version` raised to the first app release that copes with the change.
"""


def _reasons(changes, latest_tag):
    about_the_api = [change for change in changes if change["id"] not in NOT_ABOUT_THE_API]
    if not about_the_api:
        return f"No change to the API since {latest_tag}, by oasdiff.\n"
    names = {1: "information", 2: "warning", ERROR: "error"}
    lines = [f"oasdiff, against {latest_tag}:\n"]
    for change in about_the_api:
        where = " ".join(part for part in (change.get("operation"), change.get("path")) if part)
        lines.append(f"- {names.get(change['level'], change['level'])}: "
                     f"{where + ': ' if where else ''}{change['text']}")
    return "\n".join(lines) + "\n"


def _refusal(why, reasons):
    return f"## No release\n\n{why}\n\n{reasons}"


def _write(variable, text):
    path = os.environ.get(variable)
    if path:
        with open(path, "a", encoding="utf-8") as out:
            out.write(text)
    else:
        print(text)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("latest", help="print the newest release's tag, read from stdin")
    decide_command = commands.add_parser("decide", help="decide the next release's version")
    decide_command.add_argument("--bump", choices=("auto",) + STEPS, required=True)
    decide_command.add_argument("--latest", required=True, help="the newest release's tag")
    decide_command.add_argument("--changes", required=True, help="oasdiff's changelog as JSON")
    args = parser.parse_args(argv)

    if args.command == "latest":
        latest = latest_release(sys.stdin.read().split())
        if latest is None:
            print("::error::No release tag vX.Y.Z to start from.", file=sys.stderr)
            return 1
        print("v" + ".".join(str(part) for part in latest))
        return 0

    latest = latest_release([args.latest])
    if latest is None:
        print(f"::error::{args.latest} is not a release tag vX.Y.Z.", file=sys.stderr)
        return 1
    with open(args.changes, encoding="utf-8") as changes:
        decision = decide(args.bump, latest, json.load(changes) or [])
    _write("GITHUB_STEP_SUMMARY", decision.summary)
    if decision.version is None:
        print("::error::No release: see the run's summary.", file=sys.stderr)
        return 1
    _write("GITHUB_OUTPUT", f"version={decision.version}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
