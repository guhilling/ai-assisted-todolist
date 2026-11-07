#!/usr/bin/env python3
"""
Fails when a link in the documentation hides that it leads somewhere an outsider cannot open
(#531).

Run it from anywhere, with the packages in requirements.txt installed:

    python3 .github/scripts/check-private-links.py

TaskFest is open source, so a link to a private resource is followed by the plain text
` (private)`, as `doc/README.md` describes. This checks the Markdown under `doc/` and every
`README.md` and `CLAUDE.md`:

- A link to a GitHub repository that isn't public needs the marker, and one to a public
  repository must not have it, or the marker would stop meaning anything. Whether a repository is
  public is GitHub's answer to `GET /repos/<owner>/<repo>`: a 200 says, by its `private` field,
  and a 404 is not public. So no list of private repositories needs keeping. Each repository is
  asked about once, with `GITHUB_TOKEN` when it is set; the token Actions gives a workflow sees no
  other private repository, which is what makes those a 404. This repository is public and is
  not asked about. Any other answer, after build-site.py's retries, fails the check as a question
  that could not be asked, never as a missing marker.
- A link into one of the consoles and other private resources in `PRIVATE` needs the marker.

Each page is rendered as the documentation site renders it, with build-site.py's renderer, so
what counts as a link, and what as code, is what the reader sees. Every `<a href>` outside code is
a link, and so is a bare URL in the text, because GitHub links those; the marker is the text right
after it, which may start the next line.
"""

import collections
import html.parser
import importlib.util
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
THIS_REPOSITORY = "guhilling/ai-assisted-todolist"
PAGES = ["doc/*.md", ":(glob)**/README.md", ":(glob)**/CLAUDE.md"]

_spec = importlib.util.spec_from_file_location(
    "build_site", pathlib.Path(__file__).with_name("build-site.py"))
build_site = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build_site)

# Private resources that are no repository, which nothing can ask about. A link into any of them
# needs the marker.
PRIVATE = [re.compile(rf"https?://{pattern}(?:[/?#]|$)", re.I) for pattern in [
    r"appstoreconnect\.apple\.com",
    r"play\.google\.com/console",
    r"(?:[\w-]+\.)*console\.aws\.amazon\.com",
    r"console\.hetzner\.(?:cloud|com)",
    r"accounts\.hetzner\.com",
    r"github\.com/users/guhilling/projects/2",  # TaskFest's project, which GitHub says is private
]]

# GitHub's top-level paths that are no owner, such as a user's projects or one's own issues.
NO_OWNER = {
    "about", "account", "apps", "blog", "codespaces", "collections", "contact", "copilot",
    "customer-stories", "dashboard", "discussions", "education", "enterprise", "enterprises",
    "events", "explore", "features", "github-copilot", "issues", "join", "login", "logout",
    "marketplace", "new", "nonprofit", "notifications", "organizations", "orgs", "pricing",
    "pulls", "readme", "resources", "search", "security", "sessions", "settings", "signup", "site",
    "solutions", "sponsors", "stars", "team", "teams", "topics", "trending", "users", "watching",
}

MARKER = re.compile(r"\s+\(private\)")
BARE_URL = re.compile(r"https?://[^\s<>\"]+")
# End tags the marker may come after, as in `**[a](url)** (private)`.
INLINE = {"strong", "em", "b", "i", "span", "del", "s"}

Link = collections.namedtuple("Link", "line url marked")
Result = collections.namedtuple("Result", "problems links")


class Unanswered(Exception):
    """GitHub could not be asked about a repository; the message says why."""


class _Links(html.parser.HTMLParser):
    """Every link in a rendered page, as [url, marked], in order."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.found = []
        self.code = 0
        self.href = None
        self.waiting = None

    def handle_starttag(self, tag, attrs):
        self.waiting = None
        if tag in ("code", "pre"):
            self.code += 1
        elif tag == "a" and not self.code:
            href = (dict(attrs).get("href") or "").split()
            self.href = href[0] if href else ""

    def handle_endtag(self, tag):
        if tag in ("code", "pre"):
            self.code = max(0, self.code - 1)
        if tag == "a" and self.href is not None:
            self.waiting = [self.href, False]
            self.found.append(self.waiting)
            self.href = None
        elif tag not in INLINE:
            self.waiting = None

    def handle_data(self, data):
        if self.waiting is not None:
            self.waiting[1] = bool(MARKER.match(data))
            self.waiting = None
        if self.code or self.href is not None:
            return
        for match in BARE_URL.finditer(data):
            url = _trimmed(match.group(0))
            rest = data[match.start() + len(url):]
            entry = [url, bool(MARKER.match(rest))]
            self.found.append(entry)
            if not rest.strip():
                self.waiting = entry


def _trimmed(url):
    """A bare URL without the punctuation after it, as GitHub's autolinking takes it."""
    while url:
        if url[-1] in ".,:;!?'\"*_~":
            url = url[:-1]
        elif url[-1] == ")" and url.count(")") > url.count("("):
            url = url[:-1]
        else:
            break
    return url


def links(text):
    """
    Each link in a page of Markdown, in order. Its line is where its URL is next found in the
    source after the link before; a URL the renderer changed gets the line of the link before.
    """
    parser = _Links()
    parser.feed(build_site.renderer().convert(text))
    parser.close()
    found = []
    position = 0
    for url, marked in parser.found:
        at = text.find(url, position)
        if at >= 0:
            position = at + len(url)
        found.append(Link(text.count("\n", 0, position) + 1, url, marked))
    return found


def private_resource(url):
    """Whether `url` leads into one of the private resources in PRIVATE."""
    return any(pattern.match(url) for pattern in PRIVATE)


def repository(url):
    """The `owner/repo` a GitHub URL leads into, in lower case, or None for no repository."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https") or parts.netloc.lower() not in (
            "github.com", "www.github.com"):
        return None
    segments = parts.path.split("/")[1:3]
    if len(segments) < 2 or not all(segments) or segments[0].lower() in NO_OWNER:
        return None
    owner, name = segments[0].lower(), segments[1].lower()
    name = name[:-len(".git")] if name.endswith(".git") else name
    return f"{owner}/{name}" if name else None


def check(pages, ask):
    """
    The problems in `pages`, a page's text by its path, as (path, line, message), and how many
    links were checked.

    `ask` takes `owner/repo` and says whether GitHub shows it as public, raising Unanswered when
    GitHub could not be asked. It is called once per repository.
    """
    answers = {THIS_REPOSITORY: True}
    problems = []
    count = 0
    for path, text in pages.items():
        for link in links(text):
            if private_resource(link.url):
                count += 1
                if not link.marked:
                    problems.append((path, link.line, f"the link to {link.url} needs ' (private)'"
                                                      f" after it: it leads to a private resource"))
                continue
            name = repository(link.url)
            if not name:
                continue
            count += 1
            if name not in answers:
                try:
                    answers[name] = ask(name)
                except Unanswered as error:
                    answers[name] = None
                    problems.append((path, link.line,
                                     f"could not ask GitHub about {name}: {error}"))
            public = answers[name]
            if public and link.marked:
                problems.append((path, link.line, f"the link to {name} has ' (private)' after it,"
                                                  f" but the repository is public"))
            elif public is False and not link.marked:
                problems.append((path, link.line, f"the link to {name} needs ' (private)' after"
                                                  f" it: the repository is not public"))
    return Result(problems, count)


def ask_github(name, token, urlopen=urllib.request.urlopen, attempts=3, pause=5):
    """
    Whether GitHub shows the repository `name` as public. A 404 is not public; any other failure,
    once build-site.py's retries are spent, raises Unanswered.
    """
    request = urllib.request.Request(f"https://api.github.com/repos/{name}", headers={
        "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "check-private-links"})
    if token:
        request.add_header("Authorization", f"Bearer {token}")

    def read():
        try:
            with urlopen(request, timeout=30) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return 404, None
            raise

    try:
        status, body = build_site.retrying(read, attempts, pause)
    except OSError as error:
        raise Unanswered(str(error) or type(error).__name__) from error
    if status == 404:
        return False
    if status != 200:
        raise Unanswered(f"GitHub answered {status}")
    try:
        private = json.loads(body).get("private")
    except (ValueError, AttributeError) as error:
        raise Unanswered(f"GitHub's answer is no JSON object: {error}") from error
    if not isinstance(private, bool):
        raise Unanswered("GitHub's answer does not say whether it is private")
    return not private


def pages():
    """The text of every page this checks, by its path in the repository."""
    listed = subprocess.run(["git", "ls-files", "-z", "--", *PAGES], cwd=ROOT, check=True,
                            capture_output=True, text=True).stdout
    return {path: (ROOT / path).read_text(encoding="utf-8")
            for path in sorted(filter(None, listed.split("\0")))}


def main():
    found = pages()
    token = os.environ.get("GITHUB_TOKEN") or None
    result = check(found, lambda name: ask_github(name, token))
    for path, line, message in result.problems:
        print(f"::error file={path},line={line}::{path}:{line}: {message}")
    print(f"{result.links} links to private resources and GitHub repositories in {len(found)}"
          f" pages, {len(result.problems)} problem(s)")
    return 1 if result.problems else 0


if __name__ == "__main__":
    sys.exit(main())
