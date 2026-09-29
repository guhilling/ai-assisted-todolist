#!/usr/bin/env python3
"""
Assembles the GitHub Pages site that publishes the API contract.

    python3 .github/scripts/build-api-site.py _site

The site is one directory per version of the contract, each holding the same files the
repository holds plus a rendered reference:

    _site/index.html            lists the versions
    _site/redoc.standalone.js   the renderer, vendored rather than loaded from a CDN
    _site/api/main/             the moving snapshot: doc/api as it is on main
    _site/api/v1.2.3/           one per release tag, read out of git history
    _site/api/latest/           a copy of the newest release

Why built from git history rather than accumulated on a branch: every version of the contract
is already committed at its tag, so the whole site can be rebuilt from scratch on every run.
Nothing has to be preserved between deployments, and a deployment cannot be half a site.

Why `main` is published at all: a release-only spec answers what the last release promised,
never what the code currently does. The `main` directory is this project's `-SNAPSHOT`.

Why the version is patched for a tag: `info.version` comes from the Maven revision, which is
permanently `1.0.0-SNAPSHOT` on main (see `doc/releasing.md`), so the committed file at tag
`v1.2.3` claims to be a snapshot. The tag is the version, so it is written in. The release
assets need no such patching -- the release build generates them at the real version -- which
is why those, not these, are the authoritative download.

Why the renderer is vendored: Redocly's generated page loads Redoc from `cdn.redocly.com` and
its fonts from Google Fonts. The bundle is fetched at build time and served from the site, and
the font link is dropped, so a published page makes no third-party request at all. That matters
more here than a megabyte of bandwidth or two named typefaces.
"""
from __future__ import annotations

import os
import pathlib
import re
import shutil
import subprocess
import sys
import urllib.request

REPO = pathlib.Path(__file__).resolve().parents[2]
CONTRACT = "doc/api"
SPEC_FILES = ("openapi.json", "openapi.yaml")

# Pinned deliberately. Renovate does not track an npx invocation, so this is bumped by hand;
# in exchange the rendered output is reproducible, and the Redoc version it pulls is pinned by
# the CLI version rather than by whatever "latest" happens to mean on the day.
REDOCLY_CLI = "@redocly/cli@2.55.0"
BUNDLE_NAME = "redoc.standalone.js"
BUNDLE_SRC = re.compile(r'src="(https://cdn\.redocly\.com/[^"]+\.js)"')
# Redoc's default theme names Montserrat and Roboto and links them from Google Fonts. Dropping
# the link leaves the page on the system sans-serif, which costs nothing anyone will notice and
# is the difference between a site that makes no third-party request and one that makes one.
WEBFONT_LINK = re.compile(r'<link[^>]*fonts\.googleapis\.com[^>]*>')

# The only version string the generated document contains, asserted rather than assumed.
SNAPSHOT_VERSION_LINE = "\n  version: 1.0.0-SNAPSHOT\n"


def git(*args: str) -> str:
    """Runs git in the repository and returns its stdout, failing loudly on a non-zero exit."""
    return subprocess.run(
        ["git", *args], cwd=REPO, check=True, capture_output=True, text=True
    ).stdout


def release_tags() -> list[str]:
    """Release tags, newest first. `-v:refname` sorts 1.10.0 above 1.9.0, which a text sort does not."""
    listed = git("tag", "--list", "v[0-9]*", "--sort=-v:refname").split()
    return [tag for tag in listed if f"{CONTRACT}/openapi.json" in git("ls-tree", "-r", "--name-only", tag)]


def contract_files(ref: str | None) -> dict[str, str]:
    """
    The contract at one ref, as a mapping of path relative to `doc/api` to file contents.

    `None` means the working tree, which is how `main` is published: the checkout already has
    the files, and reading them from disk rather than from `HEAD` also makes the script usable
    on an uncommitted change.
    """
    if ref is None:
        directory = REPO / CONTRACT
        return {
            str(path.relative_to(directory)): path.read_text()
            for path in sorted(directory.rglob("*"))
            if path.is_file() and path.suffix in {".json", ".yaml"}
        }

    listed = git("ls-tree", "-r", "--name-only", ref, "--", CONTRACT).split()
    return {
        path[len(CONTRACT) + 1:]: git("show", f"{ref}:{path}")
        for path in listed
        if path.endswith((".json", ".yaml"))
    }


def with_version(files: dict[str, str], version: str) -> dict[str, str]:
    """
    Rewrites the snapshot version in both spec files to the released one.

    The substitution is asserted rather than attempted: if the document ever stops carrying
    exactly one snapshot version line, this fails instead of silently publishing a spec that
    claims to be something it is not.
    """
    patched = dict(files)
    json_snapshot = '"version": "1.0.0-SNAPSHOT"'
    for name, old in (("openapi.yaml", SNAPSHOT_VERSION_LINE), ("openapi.json", json_snapshot)):
        content = patched[name]
        if content.count(old) != 1:
            raise SystemExit(f"{name}: expected exactly one {old.strip()!r}, found {content.count(old)}")
        patched[name] = content.replace(old, old.replace("1.0.0-SNAPSHOT", version))
    return patched


def write(directory: pathlib.Path, files: dict[str, str]) -> None:
    """Writes one version's files, creating the `schema/` subdirectory the paths imply."""
    for name, content in files.items():
        target = directory / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)


def render(directory: pathlib.Path) -> None:
    """Renders the reference page for one version next to its spec."""
    subprocess.run(
        ["npx", "--yes", REDOCLY_CLI, "build-docs", "openapi.yaml", "-o", "index.html"],
        cwd=directory,
        check=True,
        # The repository fixed S6505 by passing --ignore-scripts everywhere packages are
        # installed. npx is no exception, and it takes the setting through the environment.
        env={**os.environ, "npm_config_ignore_scripts": "true"},
    )


def vendor_renderer(site: pathlib.Path, pages: list[pathlib.Path]) -> None:
    """Makes the rendered pages self-contained: the bundle is copied in, the webfonts dropped."""
    urls = {match.group(1) for page in pages for match in [BUNDLE_SRC.search(page.read_text())] if match}
    if len(urls) != 1:
        raise SystemExit(f"expected one Redoc bundle URL across the rendered pages, found {sorted(urls)}")

    url = urls.pop()
    with urllib.request.urlopen(url) as response:
        (site / BUNDLE_NAME).write_bytes(response.read())
    print(f"vendored {url}")

    for page in pages:
        depth = len(page.relative_to(site).parts) - 1
        rendered = BUNDLE_SRC.sub(f'src="{"../" * depth}{BUNDLE_NAME}"', page.read_text())
        page.write_text(WEBFONT_LINK.sub("", rendered))


def index(site: pathlib.Path, versions: list[tuple[str, str]]) -> None:
    """Writes the landing page: what this site is, and one entry per published version."""
    rows = "\n".join(
        f'      <li><a href="api/{slug}/">{label}</a>'
        f' <span>· <a href="api/{slug}/openapi.yaml">openapi.yaml</a>'
        f' · <a href="api/{slug}/openapi.json">openapi.json</a></span></li>'
        for slug, label in versions
    )
    (site / "index.html").write_text(f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ai-assisted-todolist API</title>
<style>
  :root {{ color-scheme: light dark; --fg: #1a1a1a; --muted: #5a5a5a; --bg: #fdfdfc; --line: #e3e3e0; }}
  @media (prefers-color-scheme: dark) {{
    :root {{ --fg: #e8e8e6; --muted: #9a9a96; --bg: #17171a; --line: #2e2e33; }}
  }}
  body {{ margin: 0 auto; padding: 3rem 1rem; max-width: 40rem; background: var(--bg); color: var(--fg);
         font: 1rem/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }}
  h1 {{ font-size: 1.5rem; margin: 0 0 .25rem; }}
  p {{ color: var(--muted); }}
  ul {{ list-style: none; padding: 0; }}
  li {{ padding: .7rem 0; border-top: 1px solid var(--line); }}
  a {{ color: inherit; }}
  span {{ color: var(--muted); font-size: .85rem; }}
</style>
</head>
<body>
  <h1>ai-assisted-todolist API</h1>
  <p>The REST contract, published as OpenAPI 3.1 and as one JSON Schema per type. Each version
     links to a rendered reference; the schemas sit beside the spec under <code>schema/</code>.
     <strong>main</strong> tracks the current code rather than the last release.</p>
    <ul>
{rows}
    </ul>
  <p><a href="https://github.com/guhilling/ai-assisted-todolist">guhilling/ai-assisted-todolist</a></p>
</body>
</html>
""")


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(f"usage: {argv[0]} <output-directory>", file=sys.stderr)
        return 1

    site = pathlib.Path(argv[1])
    if site.exists():
        shutil.rmtree(site)

    published: list[tuple[str, str]] = [("main", "main (snapshot)")]
    write(site / "api" / "main", contract_files(None))

    tags = release_tags()
    for tag in tags:
        write(site / "api" / tag, with_version(contract_files(tag), tag.removeprefix("v")))
        published.append((tag, tag))
    if tags:
        shutil.copytree(site / "api" / tags[0], site / "api" / "latest")
        published.insert(0, ("latest", f"latest ({tags[0]})"))

    pages = []
    for slug, _ in published:
        directory = site / "api" / slug
        render(directory)
        pages.append(directory / "index.html")

    vendor_renderer(site, pages)
    index(site, published)
    print(f"built {site} with: {', '.join(slug for slug, _ in published)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
