#!/usr/bin/env python3
"""
Assembles the GitHub Pages site: the project documentation and the API contract.

    pip install -r .github/scripts/requirements.txt
    python3 .github/scripts/build-site.py _site

What it produces:

    index.html            the README, as the landing page
    doc/<name>.html       every file in doc/, with a sidebar linking the others
    doc/images/           the generated diagrams the docs refer to
    api/index.html        the versions of the contract
    api/main/             the moving snapshot: doc/api as it is on main
    api/v1.2.3/           one per release tag, read out of git history
    api/latest/           a copy of the newest release
    assets/               the stylesheet, the logo, the favicon

Why the documentation is rendered here rather than left on GitHub: `doc/` is the source of
truth for this project, and reading it meant either cloning the repository or clicking through
a file browser. Rendering it costs one dependency and makes the docs linkable.

Why built from git history rather than accumulated on a branch: every version of the contract is
already committed at its tag, so the whole site is rebuilt from scratch on each run. Nothing has
to survive between deployments, and a deployment cannot be half a site.

Why `main` is published as well as the releases: a release-only spec answers what the last
release promised, never what the code currently does. The `api/main` directory is this project's
`-SNAPSHOT`.

Why the version is patched for a tag: `info.version` comes from the Maven revision, which is
permanently `1.0.0-SNAPSHOT` on main (see `doc/releasing.md`), so the committed file at tag
`v1.2.3` claims to be a snapshot. The tag is the version, so it is written in. The release assets
need no such patching -- the release build generates them at the real version -- which is why
those, not these, are the authoritative download.

Why the API reference is vendored: Redocly's generated page loads Redoc from `cdn.redocly.com`.
It is fetched at build time and served from the site, and `--disableGoogleFont` keeps the web
fonts away, so a published page makes no third-party request at all.
"""
from __future__ import annotations

import html
import os
import pathlib
import posixpath
import re
import shutil
import subprocess
import sys
import urllib.request

import markdown

REPO = pathlib.Path(__file__).resolve().parents[2]
SCRIPTS = pathlib.Path(__file__).resolve().parent
CONTRACT = "doc/api"
DOCS = REPO / "doc"
IMAGES = DOCS / "images"

PROJECT = "ai-assisted-todolist"
REPO_URL = f"https://github.com/guhilling/{PROJECT}"
SITE_URL = f"https://guhilling.github.io/{PROJECT}/"

# Pinned deliberately. Renovate does not track an npx invocation, so this is bumped by hand; in
# exchange the rendered output is reproducible, and the Redoc version it pulls is pinned by the
# CLI version rather than by whatever "latest" happens to mean on the day.
REDOCLY_CLI = "@redocly/cli@2.55.0"
BUNDLE_NAME = "redoc.standalone.js"
BUNDLE_SRC = re.compile(r'src="(https://cdn\.redocly\.com/[^"]+\.js)"')

# The only version string the generated document contains, asserted rather than assumed.
SNAPSHOT_VERSION_LINE = "\n  version: 1.0.0-SNAPSHOT\n"

# The order the sidebar lists the documentation in, which is doc/README.md's order rather than
# the alphabetical one: it goes from why the project exists to how a release is cut. A file that
# is added and not listed here still appears, at the end, rather than vanishing silently.
DOC_ORDER = [
    "purpose",
    "architecture",
    "domain-model",
    "authentication",
    "local-development",
    "testing",
    "releasing",
    "decisions",
]


def git(*args: str) -> str:
    """Runs git in the repository and returns its stdout, failing loudly on a non-zero exit."""
    return subprocess.run(
        ["git", *args], cwd=REPO, check=True, capture_output=True, text=True
    ).stdout


# --------------------------------------------------------------------------------------------
# The API contract
# --------------------------------------------------------------------------------------------


def release_tags() -> list[str]:
    """Release tags, newest first. `-v:refname` sorts 1.10.0 above 1.9.0, which a text sort does not."""
    listed = git("tag", "--list", "v[0-9]*", "--sort=-v:refname").split()
    return [tag for tag in listed if f"{CONTRACT}/openapi.json" in git("ls-tree", "-r", "--name-only", tag)]


def contract_files(ref: str | None) -> dict[str, str]:
    """
    The contract at one ref, as a mapping of path relative to `doc/api` to file contents.

    `None` means the working tree, which is how `main` is published: the checkout already has the
    files, and reading them from disk rather than from `HEAD` also makes the script usable on an
    uncommitted change.
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


def write_files(directory: pathlib.Path, files: dict[str, str]) -> None:
    """Writes one version's files, creating the `schema/` subdirectory the paths imply."""
    for name, content in files.items():
        target = directory / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)


def render_reference(directory: pathlib.Path, label: str) -> None:
    """Renders the API reference for one version, beside its spec."""
    subprocess.run(
        [
            "npx", "--yes", REDOCLY_CLI, "build-docs", "openapi.yaml",
            "-o", "index.html",
            "--title", f"{PROJECT} API · {label}",
            # Redoc otherwise links Montserrat and Roboto from Google Fonts. The site's own
            # stack is a system one, so there is nothing to fetch and nothing to wait for.
            "--disableGoogleFont",
            # The palette doc/images/generate.py draws the logo and the diagrams with, so the
            # reference does not look like a different project's page.
            "--theme.openapi.theme.colors.primary.main=#1a73e8",
            "--theme.openapi.theme.typography.fontFamily=system-ui, -apple-system, "
            "BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
            "--theme.openapi.theme.typography.headings.fontFamily=system-ui, -apple-system, "
            "BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
            "--theme.openapi.theme.typography.code.fontFamily=ui-monospace, SFMono-Regular, "
            "Menlo, Consolas, monospace",
            "--theme.openapi.theme.sidebar.width=17rem",
            # Redoc renders this as the words "Download OpenAPI specification:" followed by
            # nothing, because build-docs inlines the document rather than pointing at a URL.
            # The real files sit next to this page, and the bar above links them.
            "--theme.openapi.hideDownloadButton=true",
        ],
        cwd=directory,
        check=True,
        # npx fetches a package to run it, and a fetched package's install scripts would
        # otherwise run with whatever this job can reach. Nothing is being built from that
        # package here, only a document rendered, so the scripts have nothing to do.
        env={**os.environ, "npm_config_ignore_scripts": "true"},
    )


REFERENCE_BAR_STYLE = """<style>
  .site-return {
    position: sticky; top: 0; z-index: 100; display: flex; align-items: center; gap: 1rem;
    padding: 0.55rem 1.1rem; background: #ffffff; border-bottom: 1px solid #d5dbe1;
    font: 500 0.9rem/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      Helvetica, Arial, sans-serif;
  }
  .site-return a { color: #5b6672; text-decoration: none; }
  .site-return a:hover { color: #1a1f24; }
  .site-return .home { display: flex; align-items: center; gap: 0.5rem; color: #1a1f24;
    font-weight: 650; }
  .site-return .home img { display: block; width: 22px; height: 22px; }
  .site-return .rest { margin-left: auto; display: flex; gap: 1rem; }
</style>"""


def reference_bar(up: str) -> str:
    """The one piece of the site that the API reference carries: a way back out of it."""
    return (
        f'<div class="site-return">'
        f'<a class="home" href="{up}"><img src="{up}assets/logo-light.svg" alt="">'
        f'{PROJECT}</a>'
        f'<span class="rest"><a href="openapi.yaml">openapi.yaml</a>'
        f'<a href="openapi.json">openapi.json</a>'
        f'<a href="{up}doc/">Docs</a>'
        f'<a href="{up}api/">All versions</a>'
        f'<a href="{REPO_URL}">GitHub</a></span>'
        f"</div>"
    )


def vendor_renderer(site: pathlib.Path, pages: list[pathlib.Path]) -> None:
    """Downloads the bundle the rendered pages ask a CDN for, and points them at the copy."""
    urls = {match.group(1) for page in pages for match in [BUNDLE_SRC.search(page.read_text())] if match}
    if len(urls) != 1:
        raise SystemExit(f"expected one Redoc bundle URL across the rendered pages, found {sorted(urls)}")

    url = urls.pop()
    with urllib.request.urlopen(url) as response:
        (site / BUNDLE_NAME).write_bytes(response.read())
    print(f"vendored {url}")

    for page in pages:
        depth = len(page.relative_to(site).parts) - 1
        up = "../" * depth
        rendered = BUNDLE_SRC.sub(f'src="{up}{BUNDLE_NAME}"', page.read_text())
        # Redoc's page has no favicon of its own, and a tab with the project's mark on it is the
        # cheapest way to make the reference feel like part of the site rather than a detour.
        rendered = rendered.replace(
            "</head>",
            f'<link rel="icon" href="{up}assets/favicon.svg" type="image/svg+xml">'
            f"{REFERENCE_BAR_STYLE}</head>",
            1,
        )
        # A reference with no way back is a dead end, and Redoc renders no chrome of its own.
        # The bar is styled inline rather than by linking site.css, so that nothing here can
        # reach into Redoc's own layout: it is light-only, and site.css would repaint its
        # background in a dark browser.
        rendered = rendered.replace("<body>", f"<body>{reference_bar(up)}", 1)
        page.write_text(rendered)


# --------------------------------------------------------------------------------------------
# The page shell
# --------------------------------------------------------------------------------------------


def masthead(depth: int, current: str) -> str:
    """The bar at the top of every page this script writes. `depth` is how far from the root."""
    up = "../" * depth
    links = [("Docs", f"{up}doc/", "doc"), ("API", f"{up}api/", "api"), ("GitHub", REPO_URL, "")]
    nav = "\n      ".join(
        f'<a href="{href}"{" aria-current=\"page\"" if key and key == current else ""}>{text}</a>'
        for text, href, key in links
    )
    return f"""  <header class="masthead">
    <a class="masthead__home" href="{up}">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="{up}assets/logo-dark.svg">
        <img src="{up}assets/logo-light.svg" alt="" width="26" height="26">
      </picture>
      {PROJECT}
    </a>
    <nav>
      {nav}
    </nav>
  </header>"""


def footer(depth: int) -> str:
    up = "../" * depth
    return f"""  <footer class="site-footer">
    <span>Apache-2.0</span>
    <a href="{REPO_URL}">Source on GitHub</a>
    <a href="{up}api/">API contract</a>
    <span>Built from <code>main</code>; every page here is generated.</span>
  </footer>"""


def page(*, title: str, description: str, depth: int, current: str, body: str) -> str:
    """One complete HTML document, shell and all."""
    up = "../" * depth
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(description)}">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="{up}assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="{up}assets/site.css">
</head>
<body>
{masthead(depth, current)}
{body}
{footer(depth)}
</body>
</html>
"""


# --------------------------------------------------------------------------------------------
# The documentation
# --------------------------------------------------------------------------------------------

# A link in the sources points at a file in the repository. On the site the same destination is
# a page, so `.md` becomes `.html`, and the two directories that are not documentation are sent
# where their content actually lives.
LINK = re.compile(r'(href|src)="([^"#:]+)(#[^"]*)?"')


def site_path(repo_relative: str) -> str | None:
    """
    Where a repository path lives on the site, or None if the site does not carry it.

    None is not a failure: a document linking to `LICENSE` or to a `CLAUDE.md` means the file in
    the repository, and the honest destination for those is GitHub rather than a page here that
    would not exist.
    """
    if repo_relative in {"doc/api", "doc/api/"} or repo_relative.startswith("doc/api/"):
        return "api/main/" + repo_relative[len("doc/api/"):] if len(repo_relative) > len("doc/api") else "api/main/"
    if repo_relative.startswith("doc/images/"):
        return repo_relative
    if repo_relative == "doc":
        return "doc/"
    if repo_relative.startswith("doc/") and repo_relative.endswith(".md"):
        stem = repo_relative[len("doc/"):-len(".md")]
        return "doc/index.html" if stem == "README" else f"doc/{stem}.html"
    return None


def retarget_links(rendered: str, *, base: str, depth: int) -> str:
    """
    Rewrites links written for the repository so they resolve on the site.

    `base` is the directory the source file sits in, because its links are relative to that;
    `depth` is how deep the resulting page sits, because the rewritten ones are relative to it.
    """
    up = "../" * depth

    def replace(match: re.Match[str]) -> str:
        attribute, target, fragment = match.group(1), match.group(2), match.group(3) or ""
        if target.startswith(("/", "#")):
            return match.group(0)
        repo_relative = posixpath.normpath(posixpath.join(base, target))
        trailing = "/" if target.endswith("/") and not repo_relative.endswith("/") else ""
        moved = site_path(repo_relative + trailing)
        destination = f"{up}{moved}" if moved else f"{REPO_URL}/blob/main/{repo_relative}"
        return f'{attribute}="{destination}{fragment}"'

    return LINK.sub(replace, rendered)


def check_links(site: pathlib.Path) -> None:
    """
    Fails the build on an internal link that leads nowhere.

    Every page here is generated from files that move independently -- a document renamed, a
    diagram regenerated, a rule in `site_path` that stopped covering a case. Nothing else would
    notice; a published site simply grows 404s that only a reader finds.
    """
    link = re.compile(r'(?:href|src)="([^"]+)"')
    dead: dict[str, set[str]] = {}
    for page in sorted(site.rglob("*.html")):
        for target in link.findall(page.read_text(errors="ignore")):
            if target.startswith(("http://", "https://", "#", "mailto:", "data:")):
                continue
            clean = target.split("#")[0].split("?")[0]
            if not clean:
                continue
            resolved = (page.parent / clean).resolve()
            if not (resolved.exists() or (resolved / "index.html").exists()):
                dead.setdefault(str(page.relative_to(site)), set()).add(target)
    if dead:
        for page, targets in sorted(dead.items()):
            print(f"{page}: {', '.join(sorted(targets))}", file=sys.stderr)
        raise SystemExit("the site has links that lead nowhere")
    print("every internal link resolves")


def doc_pages() -> list[tuple[str, str]]:
    """Every documentation page as (slug, title), in reading order rather than alphabetical."""
    slugs = sorted(path.stem for path in DOCS.glob("*.md") if path.stem != "README")
    ordered = [slug for slug in DOC_ORDER if slug in slugs]
    ordered += [slug for slug in slugs if slug not in DOC_ORDER]
    return [(slug, first_heading(DOCS / f"{slug}.md")) for slug in ordered]


def first_heading(path: pathlib.Path) -> str:
    """A document's own `#` heading, so the navigation calls it what it calls itself."""
    for line in path.read_text().splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return path.stem


def sidebar(pages: list[tuple[str, str]], current: str) -> str:
    """The list of documents, marking the one being read."""
    items = [("index", "Overview")] + pages
    links = "\n      ".join(
        f'<li><a href="{"index.html" if slug == "index" else f"{slug}.html"}"'
        f'{" aria-current=\"page\"" if slug == current else ""}>{html.escape(title)}</a></li>'
        for slug, title in items
    )
    return f"""  <aside class="sidebar">
    <h2>Documentation</h2>
    <ul>
      {links}
    </ul>
    <h2>Reference</h2>
    <ul>
      <li><a href="../api/">API contract</a></li>
      <li><a href="{REPO_URL}">Source on GitHub</a></li>
    </ul>
  </aside>"""


def renderer() -> markdown.Markdown:
    """
    The markdown converter.

    `extra` brings the tables and fenced code these documents use. `toc` is here for the heading
    anchors rather than for a table of contents: every `##` becomes linkable, which is what makes
    a 700-line decisions log worth publishing. No syntax highlighting extension: seventeen code
    blocks totalling fifty-five lines, nearly all shell, do not repay a second dependency and a
    second colour scheme to keep legible.
    """
    return markdown.Markdown(
        extensions=["extra", "toc", "sane_lists"],
        extension_configs={"toc": {"permalink": "#", "permalink_title": "Link to this section"}},
    )


def split_intro(text: str) -> tuple[str, str, str]:
    """
    A README's heading, its opening sentence, and what is left.

    The landing page shows the first two as a hero, so leaving them in the body as well would
    print the project's name twice and its description twice. Taking them from the README rather
    than restating them here is what keeps the page and the repository saying the same thing.
    """
    lines = text.splitlines()
    title = next((line[2:].strip() for line in lines if line.startswith("# ")), PROJECT)

    body: list[str] = []
    intro = ""
    cursor = 0
    while cursor < len(lines):
        line = lines[cursor].strip()
        if line.startswith("# ") and not intro and not body:
            cursor += 1
            continue
        # The first ordinary paragraph: not the badge block, not a heading, not raw HTML. The
        # test is on the stripped line, because the README's hero block is indented and its
        # inner lines would otherwise look like prose.
        if not intro and line and not line.startswith(("[!", "#", "<")):
            paragraph = []
            while cursor < len(lines) and lines[cursor].strip():
                paragraph.append(lines[cursor].strip())
                cursor += 1
            intro = " ".join(paragraph)
            continue
        body.append(line)
        cursor += 1
    return title, intro, "\n".join(body)


def render_markdown(source: pathlib.Path, *, base: str, depth: int) -> str:
    """One markdown file as HTML, with its links pointed at where the site keeps things."""
    return retarget_links(renderer().convert(source.read_text()), base=base, depth=depth)


def build_docs(site: pathlib.Path) -> None:
    """Renders doc/ into doc/ on the site, each page carrying the sidebar."""
    out = site / "doc"
    out.mkdir(parents=True, exist_ok=True)
    # The artwork only. generate.py lives beside it and is not something to publish.
    (out / "images").mkdir(exist_ok=True)
    for drawing in sorted(IMAGES.glob("*.svg")):
        shutil.copyfile(drawing, out / "images" / drawing.name)

    pages = doc_pages()
    for slug, source in [("index", DOCS / "README.md")] + [(s, DOCS / f"{s}.md") for s, _ in pages]:
        body = render_markdown(source, base="doc", depth=1)
        title = first_heading(source)
        (out / f"{slug}.html").write_text(
            page(
                title=f"{title} · {PROJECT}",
                description=f"{title} — project documentation for {PROJECT}.",
                depth=1,
                current="doc",
                body=f'  <div class="layout">\n{sidebar(pages, slug)}\n'
                f'  <main class="prose">\n{body}\n  </main>\n  </div>',
            )
        )
    print(f"rendered {len(pages) + 1} documentation pages")


def build_landing(site: pathlib.Path, versions: list[tuple[str, str]]) -> None:
    """The front page: a hero taken from the README, a few ways in, then the README itself."""
    readme = (REPO / "README.md").read_text()
    # The README opens with a centred logo, which is markup because GitHub's file view has no
    # stylesheet to do it. This page has one, and shows the logo in its hero, so the block goes.
    readme = re.sub(r'^<p align="center">.*?</p>\n+', "", readme, count=1, flags=re.DOTALL)
    title, intro, rest = split_intro(readme)
    # The README points readers here. On the page it points at, that paragraph is a link to
    # itself, so it is dropped rather than published as a circular instruction.
    rest = "\n\n".join(
        block for block in rest.split("\n\n") if SITE_URL not in block
    )
    body = retarget_links(renderer().convert(rest), base="", depth=0)
    newest = versions[0][0]
    cards = [
        ("Documentation", "doc/",
         "Why the project exists, how it fits together, and every decision taken, with the "
         "rejected alternatives."),
        ("API reference", f"api/{newest}/",
         "The REST contract as OpenAPI 3.1, with one JSON Schema per type beside it."),
        ("Source", REPO_URL,
         "The repository, the pull requests, and the checks that gate them."),
    ]
    card_html = "\n      ".join(
        f'<a class="card" href="{href}"><strong>{html.escape(name)}</strong>'
        f'<span>{html.escape(text)}</span></a>'
        for name, href, text in cards
    )
    hero = f"""  <main>
    <div class="hero">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
        <img src="assets/logo-light.svg" alt="" width="84" height="84">
      </picture>
      <h1>{html.escape(title)}</h1>
      <p>{html.escape(intro)}</p>
    </div>
    <div class="cards">
      {card_html}
    </div>
    <div class="prose">
{body}
    </div>
  </main>"""
    (site / "index.html").write_text(
        page(title=PROJECT, description=intro, depth=0, current="", body=hero)
    )


def build_api_index(site: pathlib.Path, versions: list[tuple[str, str]]) -> None:
    """The list of published versions of the contract."""
    rows = "\n      ".join(
        f'<li><a href="{slug}/">{html.escape(label)}</a>'
        f'{" <span class=\"tag\">tracks main</span>" if slug == "main" else ""}'
        f'<span class="files">'
        f'<a href="{slug}/openapi.yaml">openapi.yaml</a>'
        f'<a href="{slug}/openapi.json">openapi.json</a>'
        f'<a href="{slug}/schema/TaskResponse.schema.json">schema/</a>'
        f'</span></li>'
        for slug, label in versions
    )
    body = f"""  <main class="prose">
    <h1>API contract</h1>
    <p>The REST surface as OpenAPI 3.1, and one JSON Schema per type. Because the document is
    OpenAPI 3.1, those component schemas <em>are</em> JSON Schema 2020-12 — the frontend compiles
    them into the validators it checks every response with.</p>
    <p><strong>main</strong> tracks the current code rather than the last release, which is what
    a <code>-SNAPSHOT</code> gives you in Maven. Each release is published at its own version, and
    the same documents are attached to the GitHub Release.</p>
    <ul class="versions">
      {rows}
    </ul>
  </main>"""
    (site / "api" / "index.html").write_text(
        page(
            title=f"API contract · {PROJECT}",
            description=f"The {PROJECT} REST contract as OpenAPI 3.1 and JSON Schema.",
            depth=1,
            current="api",
            body=body,
        )
    )


def build_assets(site: pathlib.Path) -> None:
    """The stylesheet and the artwork every page refers to."""
    assets = site / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SCRIPTS / "site.css", assets / "site.css")
    for name in ("logo-light.svg", "logo-dark.svg", "favicon.svg"):
        shutil.copyfile(IMAGES / name, assets / name)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(f"usage: {argv[0]} <output-directory>", file=sys.stderr)
        return 1

    site = pathlib.Path(argv[1])
    if site.exists():
        shutil.rmtree(site)

    published: list[tuple[str, str]] = [("main", "main")]
    write_files(site / "api" / "main", contract_files(None))

    tags = release_tags()
    for tag in tags:
        write_files(site / "api" / tag, with_version(contract_files(tag), tag.removeprefix("v")))
        published.append((tag, tag))
    if tags:
        shutil.copytree(site / "api" / tags[0], site / "api" / "latest")
        published.insert(0, ("latest", f"latest ({tags[0]})"))

    pages = []
    for slug, label in published:
        directory = site / "api" / slug
        render_reference(directory, label)
        pages.append(directory / "index.html")
    vendor_renderer(site, pages)

    build_assets(site)
    build_docs(site)
    build_api_index(site, published)
    build_landing(site, published)
    check_links(site)
    print(f"built {site} with API versions: {', '.join(slug for slug, _ in published)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
