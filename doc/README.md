# Documentation

Project-level documentation for `ai-assisted-todolist`. This folder is the source of
truth; the root `README.md` is a short entry point that links here.

| Document | What it covers |
| --- | --- |
| [purpose.md](purpose.md) | What this project is for, and the working conventions that follow from that |
| [architecture.md](architecture.md) | The pieces, how a request travels through them, and how they are deployed |
| [domain-model.md](domain-model.md) | Ubiquitous language, the Task aggregate, and where each invariant is enforced |
| [authentication.md](authentication.md) | The backend-for-frontend OIDC design, Google in production, Keycloak locally |
| [local-development.md](local-development.md) | How to get everything running on your machine, and how to test it |
| [testing.md](testing.md) | The test layers, what each is for, and how to run them |
| [releasing.md](releasing.md) | How a release is cut, what it checks, and what it publishes |
| [decisions.md](decisions.md) | Decisions taken, why, and what was rejected |

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
[guhilling.github.io/ai-assisted-todolist](https://guhilling.github.io/ai-assisted-todolist/) —
`/api/main/` for the current code, `/api/v1.2.3/` per release. `.github/scripts/build-api-site.py`
builds that site, and `releasing.md` says what each release attaches.

## The diagrams

`images/` holds the two diagrams the root README shows: how the application fits together,
and how a change reaches `main`. They are **generated** — `python3 doc/images/generate.py`
rewrites all four files — so edit the generator rather than the SVGs.

Four files for two diagrams, because a README is rendered by GitHub through `<img>`: an
embedded SVG has no page foreground to inherit, so `currentColor` is no use, and a `<style>`
block carrying a `prefers-color-scheme` query is stripped by GitHub's sanitiser. A light and
a dark file behind a `<picture>` element is the arrangement that actually works, and
generating both from one source is what keeps them from drifting apart.

Re-run the generator whenever a diagram stops being true — it is idempotent, so a run that
changes nothing leaves nothing to commit.

## Keeping it current

Documentation is updated in the same change as the behaviour it describes, not as a
follow-up. The root README already showed what happens otherwise: it documented an
`/api/todos` endpoint and four task states that had not existed for some time.

Code-level documentation lives in the code as Javadoc and TSDoc. The conventions for it
are in `backend/CLAUDE.md` and `frontend/CLAUDE.md`, and the backend build enforces them:
Checkstyle's `MissingJavadocType` fails `./mvnw verify` on a public type with no Javadoc.
