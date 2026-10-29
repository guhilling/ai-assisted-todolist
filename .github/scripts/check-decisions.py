#!/usr/bin/env python3
"""
Fails when the decisions under `doc/decisions/` say less than they should (#409).

Run it from anywhere:

    python3 .github/scripts/check-decisions.py

Each decision is a `##` section of a chapter, and the line under its heading says when it was
taken, where, and whether it still holds:

    *Accepted · 2026-09-25 · #14*
    *Superseded · 2026-09-25 · #14 · by [A main provider per profile](authentication.md#…)*
    *Superseded · 2026-09-27 · #51 · by #334*

A revised decision is not edited away: it is marked superseded, keeps a short summary, and names
what replaced it -- the decision that did, which must exist, or the issue or pull request where no
decision records the change. The issues and pull requests may be left out where there were none.
`index.md` lists every decision, and only those, under its chapter's section, in the chapter's
order and with the anchor its heading gets -- it had drifted to thirteen decisions missing and one
long renamed.

The anchors are worked out as the site's Markdown does for a plain heading. A heading with a link
or emphasis in it would get a different one there; none has either.
"""

import datetime
import pathlib
import re
import sys
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
DECISIONS = ROOT / "doc" / "decisions"

HEADING = re.compile(r"^## (.+)$", re.M)
FENCE = re.compile(r"^```.*?^```", re.M | re.S)
STATUS = re.compile(
    r"^\*(Accepted|Superseded) · (\d{4}-\d{2}-\d{2})(?: · #\d+(?:, #\d+)*)?"
    r"(?: · by (?:\[[^\]]+\]\(([^)]+)\)|#\d+))?\*$")
CHAPTER = re.compile(r"^## \[.+\]\(([\w-]+\.md)\)$")
ENTRY = re.compile(r"^- \[(.+)\]\(([\w-]+\.md)#([^)]+)\)$")


def sections(text):
    """Each decision in a chapter, as (heading, the first line of text under it)."""
    text = FENCE.sub("", text)
    found = []
    for match in HEADING.finditer(text):
        rest = text[match.end():].lstrip("\n")
        found.append((match.group(1), rest.split("\n", 1)[0]))
    return found


def status_problems(text):
    """What is wrong with the status lines of a chapter's decisions, one message each."""
    problems = []
    found = sections(text)
    headings = [heading for heading, _ in found]
    for heading in sorted({heading for heading in headings if headings.count(heading) > 1}):
        problems.append(f"{heading}: two decisions have this heading")
    for heading, line in found:
        match = STATUS.match(line)
        if not match:
            problems.append(f"{heading}: no status line under the heading")
        elif match.group(1) == "Accepted" and " · by " in line:
            problems.append(f"{heading}: an accepted decision names no replacement; say Superseded")
        elif match.group(1) == "Superseded" and " · by " not in line:
            problems.append(f"{heading}: a superseded decision says by which one")
        else:
            try:
                datetime.date.fromisoformat(match.group(2))
            except ValueError:
                problems.append(f"{heading}: {match.group(2)} is not a date")
    return problems


def anchor(heading):
    """The anchor the site's Markdown gives a plain heading (its `toc` extension's slugify)."""
    text = unicodedata.normalize("NFKD", heading.replace("`", "")).encode("ascii", "ignore").decode()
    text = re.sub(r"[^\w\s-]", "", text).strip().lower()
    return re.sub(r"[-\s]+", "-", text)


def replacement_problems(chapters):
    """Superseded decisions whose replacing decision, given by link, is none."""
    anchors = {(name, anchor(heading)) for name, text in chapters.items()
               for heading, _ in sections(text)}
    problems = []
    for name, text in sorted(chapters.items()):
        for heading, line in sections(text):
            match = STATUS.match(line)
            if not match or not match.group(3):
                continue
            target = match.group(3)
            file, _, fragment = target.partition("#")
            if (file or name, fragment) not in anchors:
                problems.append(f"{name}: {heading} is superseded by {target}, which is no decision")
    return problems


def index_problems(index, chapters):
    """What is wrong with `index`, given each chapter's text by its file name."""
    listed = {}
    problems = []
    current = None
    for line in index.splitlines():
        heading = CHAPTER.match(line)
        if heading:
            current = heading.group(1)
            listed.setdefault(current, [])
        elif line.startswith("- "):
            entry = ENTRY.match(line)
            if not entry:
                problems.append(f"index.md has a list item that is no entry: {line}")
            elif entry.group(2) != current:
                problems.append(f"index.md lists {entry.group(1)} under {current},"
                                f" linking to {entry.group(2)}#{entry.group(3)}")
            else:
                listed[current].append((entry.group(1), entry.group(3)))
    for name in sorted(set(listed) - set(chapters)):
        problems.append(f"index.md has a section for {name}, which is no chapter")
    for name, text in sorted(chapters.items()):
        if name not in listed:
            problems.append(f"index.md has no section for {name}")
            continue
        expected = [heading for heading, _ in sections(text)]
        if [title for title, _ in listed[name]] != expected:
            problems.append(f"index.md does not list {name}'s decisions as they are: expected\n"
                            + "\n".join(f"  {heading}" for heading in expected))
            continue
        for title, link in listed[name]:
            if link != anchor(title):
                problems.append(f"index.md links {title} as {name}#{link},"
                                f" but its anchor is #{anchor(title)}")
    return problems


def main():
    chapters = {path.name: path.read_text(encoding="utf-8")
                for path in sorted(DECISIONS.glob("*.md")) if path.name != "index.md"}
    problems = [f"{name}: {problem}" for name, text in chapters.items()
                for problem in status_problems(text)]
    problems += replacement_problems(chapters)
    problems += index_problems((DECISIONS / "index.md").read_text(encoding="utf-8"), chapters)
    for problem in problems:
        print(f"::error::{problem}")
    print(f"{sum(len(sections(text)) for text in chapters.values())} decisions,"
          f" {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
