#!/usr/bin/env python3
"""
Fails when the decisions under `doc/decisions/` say less than they should (#409).

Run it from anywhere:

    python3 .github/scripts/check-decisions.py

Each decision is a `##` section of a chapter, and the line under its heading says when it was
taken, where, and whether it still holds:

    *Accepted · 2026-09-25 · #14*
    *Superseded · 2026-09-25 · #14 · by [A main provider per profile](authentication.md#…)*

A revised decision is not edited away: it is marked superseded, keeps a short summary, and names
the decision that replaced it. The issues and pull requests may be left out where there were
none. `index.md` lists every decision, and only those, in each chapter's order, under the anchor
its heading gets -- it had drifted to thirteen decisions missing and one long renamed.
"""

import datetime
import pathlib
import re
import sys
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
DECISIONS = ROOT / "doc" / "decisions"

HEADING = re.compile(r"^## (.+)$", re.M)
STATUS = re.compile(
    r"^\*(?:Accepted|Superseded) · (\d{4}-\d{2}-\d{2})(?: · #\d+(?:, #\d+)*)?"
    r"(?: · by \[[^\]]+\]\([^)]+\))?\*$")
ENTRY = re.compile(r"^- \[(.+)\]\(([\w-]+\.md)#([^)]+)\)$", re.M)


def sections(text):
    """Each decision in a chapter, as (heading, the first line of text under it)."""
    found = []
    for match in HEADING.finditer(text):
        rest = text[match.end():].lstrip("\n")
        found.append((match.group(1), rest.split("\n", 1)[0]))
    return found


def status_problems(text):
    """What is wrong with the status lines of a chapter's decisions, one message each."""
    problems = []
    for heading, line in sections(text):
        match = STATUS.match(line)
        if not match or (line.startswith("*Accepted") and " · by [" in line):
            problems.append(f"{heading}: no status line under the heading")
        elif line.startswith("*Superseded") and " · by [" not in line:
            problems.append(f"{heading}: a superseded decision says by which one")
        else:
            try:
                datetime.date.fromisoformat(match.group(1))
            except ValueError:
                problems.append(f"{heading}: {match.group(1)} is not a date")
    return problems


def anchor(heading):
    """The anchor the site's Markdown gives a heading (its `toc` extension's slugify)."""
    text = unicodedata.normalize("NFKD", heading.replace("`", "")).encode("ascii", "ignore").decode()
    text = re.sub(r"[^\w\s-]", "", text).strip().lower()
    return re.sub(r"[-\s]+", "-", text)


def index_problems(index, chapters):
    """What is wrong with `index`, given each chapter's text by its file name."""
    entries = ENTRY.findall(index)
    problems = []
    for name, text in sorted(chapters.items()):
        expected = [heading for heading, _ in sections(text)]
        listed = [(title, link) for title, file, link in entries if file == name]
        if [title for title, _ in listed] != expected:
            problems.append(f"index.md does not list {name}'s decisions as they are: expected\n"
                            + "\n".join(f"  {heading}" for heading in expected))
            continue
        for title, link in listed:
            if link != anchor(title):
                problems.append(f"index.md links {title} as {name}#{link},"
                                f" but its anchor is #{anchor(title)}")
    return problems


def main():
    chapters = {path.name: path.read_text(encoding="utf-8")
                for path in sorted(DECISIONS.glob("*.md")) if path.name != "index.md"}
    problems = [f"{name}: {problem}" for name, text in chapters.items()
                for problem in status_problems(text)]
    problems += index_problems((DECISIONS / "index.md").read_text(encoding="utf-8"), chapters)
    for problem in problems:
        print(f"::error::{problem}")
    print(f"{sum(len(sections(text)) for text in chapters.values())} decisions,"
          f" {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
