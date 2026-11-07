#!/usr/bin/env python3
"""
Fails when a link in the documentation hides that it leads somewhere an outsider cannot open
(#531).

Run it from anywhere:

    python3 .github/scripts/check-private-links.py

TaskFest is open source, so a link to a private resource is followed by the plain text
` (private)`, as `doc/README.md` describes. This checks the links to GitHub repositories, in the
Markdown under `doc/` and in every `README.md` and `CLAUDE.md`: one to a repository that isn't
public needs the marker, and one to a public repository must not have it, or the marker would
stop meaning anything. Links to consoles and other private pages are marked by the same
convention, but nothing here can tell those apart.

Whether a repository is public is GitHub's answer to `GET /repos/<owner>/<repo>`: public is a 200
saying `"private": false`, and anything else, a 404 included, is not. So no list of private
repositories needs keeping. Each repository is asked about once, with `GITHUB_TOKEN` when it is
set; the token Actions gives a workflow sees no other private repository, which is what makes
those a 404. This repository is public and is not asked about.

A link is an inline one (`[text](url)`, the marker after its closing parenthesis), an autolink
(`<url>`) or a bare URL, outside code blocks and inline code. The marker may start the next line
when the link ends one. Reference-style links are not looked at; the documentation uses none.
"""

import collections
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
THIS_REPOSITORY = "guhilling/ai-assisted-todolist"
PAGES = ["doc/*.md", ":(glob)**/README.md", ":(glob)**/CLAUDE.md"]

FENCE = re.compile(r"^(```|~~~).*?^\1", re.M | re.S)
INLINE_CODE = re.compile(r"(`+).+?\1")
URL = re.compile(r"https?://(?:www\.)?github\.com/[^\s<>()\[\]\"'`]*", re.I)
TITLE_AND_CLOSE = re.compile(r"(?:\s+\"[^\"]*\")?\)")
MARKER = re.compile(r"(?:[ \t]+|[ \t]*\n[ \t]*)\(private\)")
# Pages of github.com whose first path segment is no owner, such as a user's projects.
NO_OWNER = {"users", "orgs", "organizations", "settings", "apps", "marketplace", "features",
            "topics", "sponsors", "notifications", "login", "enterprise", "about", "pricing",
            "search", "explore", "collections", "trending", "security", "site", "codespaces",
            "new", "readme", "events", "customer-stories"}

Link = collections.namedtuple("Link", "line repository marked")


def masked(text):
    """`text` with code blocks and inline code blanked out, keeping every position and line."""
    def blank(match):
        return re.sub(r"[^\n]", " ", match.group(0))
    return INLINE_CODE.sub(blank, FENCE.sub(blank, text))


def repository(url):
    """The `owner/repo` a GitHub URL leads into, in lower case, or None for no repository."""
    path = re.sub(r"^https?://(?:www\.)?github\.com/", "", url, flags=re.I)
    segments = re.split(r"[/?#]", path)
    if len(segments) < 2 or not segments[0] or not segments[1]:
        return None
    owner, name = segments[0].lower(), segments[1].lower()
    if owner in NO_OWNER:
        return None
    name = name[:-len(".git")] if name.endswith(".git") else name
    return f"{owner}/{name}" if name else None


def links(text):
    """Each link to a GitHub repository in a page of Markdown, in order."""
    text = masked(text)
    found = []
    for match in URL.finditer(text):
        start, end = match.span()
        url = match.group(0)
        if text[start - 2:start] == "](":
            close = TITLE_AND_CLOSE.match(text, end)
            end = close.end() if close else end
            if text.startswith("](", end):
                continue  # an image inside a link: the marker goes after the link around it
        elif text[start - 1:start] == "<" and text.startswith(">", end):
            end += 1
        else:
            url = url.rstrip(".,;:!?")
            end = start + len(url)
            if text.startswith("]", end):
                continue  # a URL as the text of a link: the link's target is what counts
        name = repository(url)
        if name:
            found.append(Link(text.count("\n", 0, start) + 1, name, bool(MARKER.match(text, end))))
    return found


def problems(pages, ask):
    """
    What is wrong with the links in `pages`, a page's text by its path, as (path, line, message).

    `ask` takes `owner/repo` and returns GitHub's answer about it: its HTTP status and, for a
    200, the repository as JSON. It is called once per repository.
    """
    found = {path: links(text) for path, text in pages.items()}
    answers = {THIS_REPOSITORY: (200, {"private": False})}
    for path_links in found.values():
        for link in path_links:
            if link.repository not in answers:
                answers[link.repository] = ask(link.repository)
    result = []
    for path, path_links in found.items():
        for link in path_links:
            status, body = answers[link.repository]
            public = status == 200 and isinstance(body, dict) and body.get("private") is False
            if public and link.marked:
                result.append((path, link.line, f"the link to {link.repository} has ' (private)'"
                                                f" after it, but the repository is public"))
            elif not public and not link.marked:
                said = ("GitHub says it is private" if status == 200 and body
                        and body.get("private") else f"GitHub answered {status}")
                result.append((path, link.line, f"the link to {link.repository} needs"
                                                f" ' (private)' after it: the repository is"
                                                f" not public ({said})"))
    return result


def ask_github(name, token, urlopen=urllib.request.urlopen):
    """GitHub's answer about the repository `name`: (HTTP status, the repository or None)."""
    request = urllib.request.Request(f"https://api.github.com/repos/{name}", headers={
        "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "check-private-links"})
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, None


def main():
    listed = subprocess.run(["git", "ls-files", "-z", "--", *PAGES], cwd=ROOT, check=True,
                            capture_output=True, text=True).stdout
    pages = {path: (ROOT / path).read_text(encoding="utf-8")
             for path in sorted(filter(None, listed.split("\0")))}
    token = os.environ.get("GITHUB_TOKEN") or None
    found = problems(pages, lambda name: ask_github(name, token))
    for path, line, message in found:
        print(f"::error file={path},line={line}::{path}:{line}: {message}")
    count = sum(len(links(text)) for text in pages.values())
    print(f"{count} links to GitHub repositories in {len(pages)} pages, {len(found)} problem(s)")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
