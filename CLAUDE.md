# CLAUDE.md

Guidance for Claude Code when working in this repository.

## About this project

This is `ai-assisted-todolist`: a browser-based todo list app (Quarkus backend,
React + TypeScript frontend, PostgreSQL persistence). It is primarily a **demo
project** — its main purpose is to build up experience with AI-assisted
software development, not to ship production software. Favor clarity and
learning value in explanations and commits over maximal speed.

## About the developer

Gunnar Hilling. Experienced software developer, especially with Java and
Quarkus. Do not over-explain Java/Quarkus/backend fundamentals — assume that
knowledge. Frontend (React/TypeScript) and AI-assisted workflows are areas
where more context and explanation are welcome.

## Ask, don't guess

If a requirement, API contract, data model, or design decision is unclear or
underspecified, **stop and ask** rather than guessing or picking a default
silently. This applies especially to:

- Domain rules and business logic for the todo model (states, transitions,
  validation rules).
- Auth/OIDC provider behavior and configuration.
- Anything where multiple reasonable implementations exist and the choice
  affects the design.

Guessing silently and moving on is the failure mode to avoid here, even if it
slows things down.

## Workflow

- Always work on a git branch, never commit directly to `main`.
- Every change reaches `main` through a pull request; the `main-branch`
  ruleset enforces it and rejects direct pushes. No approving review is
  required, so you can merge your own pull request once CI is green.
- Delete a branch once its pull request is merged — locally and on `origin` —
  unless told otherwise. Because pull requests are squash-merged, a merged
  branch does not show up in `git branch --merged main`, so stale branches are
  easy to lose track of if they are not cleaned up straight away.
- Anything that can reasonably be enforced automatically (tests, coverage,
  style/lint checks, build) should be enforced by the standard GitHub Actions
  CI/CD runs, not left as a manual convention.
- Project-level documentation lives in `/doc` and is the source of truth; the
  root `README.md` is a short entry point that links into it. Update `/doc` in
  the same change as the behaviour it describes, never as a follow-up — the
  README had already drifted into documenting endpoints and task states that no
  longer existed.
- Code-level documentation is Javadoc and TSDoc in the code itself, saying what
  a type is *for*. The conventions are in `backend/CLAUDE.md` and
  `frontend/CLAUDE.md`; on the backend they are enforced by Checkstyle.
- Deployment artifacts — the Docker Compose stacks, and the AWS material that
  will follow — live in `/docker`, not at the repository root.
- Never commit secrets (API keys, OIDC client secrets, real credentials,
  etc.). Only local, testing-only placeholder values belong in the repo
  (e.g. `.env.example`-style files or dev/test configuration); real secrets
  are supplied via environment variables / CI secrets only.
- **Never hand-edit a version.** A release is a git tag (`v1.2.3`); the
  backend's `pom.xml` carries `${revision}` and the release build overrides it
  from the tag. `main` stays `1.0.0-SNAPSHOT` permanently, and the frontend's
  `package.json` version is unused because the package is never published.
  `doc/releasing.md` has the whole procedure.
- **A SNAPSHOT dependency fails every backend build**, not just a release
  (`requireReleaseDeps` at `validate`); the npm counterpart is
  `npm run check:deps` in `frontend/`. Do not move either into a release-only
  path — the point is to fail when the dependency is added.
- **Dependency updates come from Renovate**, not by hand. Patch and minor
  updates automerge once every check is green; majors wait for Gunnar. The
  `platformAutomerge: false` in `.github/renovate.json` is load-bearing: the
  `main-branch` ruleset requires no status checks, so GitHub's own auto-merge
  would merge before anything had run.
- The project is licensed **Apache-2.0** (`LICENSE`, verbatim). There are
  deliberately no per-file license headers — see `doc/decisions.md`.

## Development methodology

- **TDD for implementation.** Write a failing test first, then the minimal
  code to make it pass, then refactor. This applies to both backend
  (JUnit/Quarkus test framework) and frontend (whatever test runner is
  configured) work. Don't write production code without a test driving it.
- **DDD for planning.** When planning a feature or change, think in terms of
  the domain first: ubiquitous language, entities, value objects, aggregates,
  and bounded contexts, before jumping to REST endpoints, database schema, or
  UI components. Surface domain modeling questions to Gunnar rather than
  assuming an answer.
- **Never change or disable an existing unit test without asking Gunnar
  first.** This includes editing its assertions/setup, deleting it, or
  marking it skipped/disabled — always ask before touching a test that
  already exists, even if it appears to be blocking other work.
