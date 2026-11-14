# Documentation

Project-level documentation for TaskFest, in the `ai-assisted-todolist` repository. This folder is the source of
truth; the root `README.md` is a short entry point that links here.

| Document | What it covers |
| --- | --- |
| [purpose.md](purpose.md) | What this project is for, and the working conventions that follow from that |
| [architecture.md](architecture.md) | The pieces, how a request travels through them, and how they are deployed |
| [domain-model.md](domain-model.md) | Ubiquitous language, the Task aggregate, and where each invariant is enforced |
| [authentication.md](authentication.md) | The backend-for-frontend OIDC design, Google in production, Keycloak locally |
| [local-development/](local-development/index.md) | How to get everything running on your machine, and how to test it |
| [testing/](testing/index.md) | The test layers, what each is for, and how to run them |
| [mobile/](mobile/index.md) | The iOS and Android app: its variants, how to run and test it, how it signs in |
| [deployment/](deployment/index.md) | The AWS environments: what runs where, who may change it, and what it costs |
| [releasing.md](releasing.md) | How a release is cut, what it checks, and what it publishes |
| [decisions/](decisions/index.md) | Decisions taken, why, and what was rejected, by topic |
| [privacy.md](privacy.md) | The application's privacy policy: what is stored, why, for how long, and who else sees it |
| [datenschutz.md](datenschutz.md) | Die Datenschutzerklärung auf Deutsch |
| [terms.md](terms.md) | The application's terms of service |
| [nutzungsbedingungen.md](nutzungsbedingungen.md) | Die Nutzungsbedingungen auf Deutsch |

## The API contract

`api/` holds the wire contract as files: the generated OpenAPI 3.1 document, and one
standalone JSON Schema per type under `api/schema/`. Like the diagrams below, these are
**generated** — `python3 doc/api/generate.py` reads what the backend build wrote to
`backend/target/openapi/` — so change the resource or the record, not the file.

Unlike the diagrams, they are enforced rather than trusted: Backend CI regenerates them and
fails on any difference. They are committed rather than built on demand because the frontend
generates its response validators from them, and because a change to the wire contract should
be visible in the pull request that causes it.

They are also published, with a rendered reference, at
[taskfest-docs.cloud.hilling.de](https://taskfest-docs.cloud.hilling.de/) —
`/api/main/` for the current code, `/api/v1.2.3/` per release. `.github/scripts/build-site.py`
builds that site, with these documents as its pages, and `releasing.md` says what each release
attaches.

### Lists on the site

The site renders these pages with Python-Markdown, which is stricter than GitHub about lists: a
code block or a second paragraph inside a list item is indented **four spaces**, even under `1.`
or `-`, where GitHub would also accept the item's text column. With less, the site takes the
block out of the list and restarts the numbering after it, and a code block becomes one line of
inline code. `build-site.py` refuses such a page, and Script tests check every page on each pull
request, since the site itself is only built on `main`.

## The diagrams

`images/` holds the diagrams: the two the root README shows, how the application fits together
on the Go backend and how a change reaches `main`; the containers' architecture, which the README
showed until the port and [architecture.md](architecture.md#two-architectures) keeps as the
reference; and the identities in [access.md](deployment/access.md). They are **generated** —
`python3 doc/images/generate.py` rewrites them, with the logo's files — so edit the generator
rather than the SVGs.

Two files for each diagram, because a README is rendered by GitHub through `<img>`: an
embedded SVG has no page foreground to inherit, so `currentColor` is no use, and a `<style>`
block carrying a `prefers-color-scheme` query is stripped by GitHub's sanitiser. A light and
a dark file behind a `<picture>` element is the arrangement that actually works, and
generating both from one source is what keeps them from drifting apart.

Re-run the generator whenever a diagram stops being true — it is idempotent, so a run that
changes nothing leaves nothing to commit.

## Links to private resources

TaskFest is open source, but a few links in these pages lead somewhere only Gunnar can open: a
private repository such as [guhilling/monitoring](https://github.com/guhilling/monitoring)
(private), the GitHub project that holds the priorities, or a console such as App Store Connect,
Play Console, the AWS console or Hetzner's. Each such link is followed by the plain text
` (private)`, so a reader sees before following it that it will not open for them:

```markdown
[guhilling/monitoring](https://github.com/guhilling/monitoring) (private)
```

Plain text rather than an icon or a badge, so it reads the same rendered, in the raw file and to
a screen reader. A link to a public resource has no marker.

Docs CI enforces it with `.github/scripts/check-private-links.py`, over `doc/` and every
`README.md` and `CLAUDE.md`. It renders each page as the site does, so a link is what a reader
sees as one, and code is left alone:

- **A link to a GitHub repository** is checked by asking GitHub about the repository. The check
  fails on a link to one that isn't public without the marker, and on a link to a public one with
  it. No list of private repositories is kept anywhere; whatever GitHub will not show the
  workflow's token counts as private. When GitHub cannot be asked, the check fails saying so.
- **A link into a console or other private resource** is checked against a short list in the
  script: App Store Connect, Play Console, the AWS console, Hetzner's consoles and accounts, and
  the TaskFest project. A private resource that isn't on the list is marked all the same; add it
  to the list when it is first linked.

## Keeping it current

Documentation is updated in the same change as the behaviour it describes, not as a
follow-up. The root README already showed what happens otherwise: it documented an
`/api/todos` endpoint and four task states that had not existed for some time.

Code-level documentation lives in the code as Javadoc and TSDoc. The conventions for it
are in `backend/CLAUDE.md` and `frontend/CLAUDE.md`, and the backend build enforces them:
Checkstyle's `MissingJavadocType` fails `./mvnw verify` on a public type with no Javadoc.
