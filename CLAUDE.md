# CLAUDE.md

Guidance for Claude Code when working in this repository.

## About this project

This is `ai-assisted-todolist`, home of **TaskFest**: a browser-based task list app (Quarkus backend,
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
- **A pull request that finishes an issue gets `/code-review high` before it merges** — any PR
  whose description says `Closes #…`. Fix what it finds, or say in the PR why a finding does
  not apply, and note the review's outcome in the PR. Docs-only changes, Renovate updates and
  follow-up fixes without an issue do not need one. For a particularly critical change Gunnar
  may run `/code-review ultra` himself; Claude cannot start that one.
- **The same pull requests get one CodeRabbit review, requested by hand** once `/code-review high`'s
  fixes are pushed: a comment `@coderabbitai review` (`gh pr comment <n> --body "@coderabbitai review"`).
  `.coderabbit.yaml` keeps it from reviewing on its own, because a review on every push of every
  pull request, Renovate's included, is what used up Copilot's monthly quota before. What it looks
  for is in `.github/REVIEW.md`, alongside the CLAUDE.md files it reads. Its findings
  are gone through with Gunnar one by one, like any other review's, and need not hold up the merge.
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
- **Long topics are chapters**: `doc/<chapter>/index.md` plus one page per sub-chapter, ordered by
  the chapter's index. A reference anywhere in the repository names the exact page it means
  (`doc/deployment/database.md`, not a section of a long file), and
  `.github/scripts/check-doc-references.py` fails CI when one names a page that does not exist.
- **The API contract is generated and drift-gated, never written twice.** The backend's
  OpenAPI document and the per-type JSON Schemas under `doc/api/` come from
  `doc/api/generate.py`; the frontend's wire types and response validators under
  `frontend/src/generated/` come from `npm run generate:api`. Backend CI and Frontend CI each
  regenerate their half and fail on any difference, so neither can go stale and neither is
  hand-edited. A wire change starts at the backend record.
- Code-level documentation is Javadoc and TSDoc in the code itself, saying what
  a type is *for*. The conventions are in `backend/CLAUDE.md`,
  `frontend/CLAUDE.md` and `mobile/CLAUDE.md`; on the backend they are enforced by Checkstyle.
- Deployment artifacts live under `/deployment`, never at the repository root:
  `deployment/docker/` holds the Compose stacks and `deployment/aws-tofu/` the AWS
  infrastructure. The AWS code is **OpenTofu**, not Terraform — the binary is `tofu`,
  and `deployment/aws-tofu/README.md` says what that changes.
- **The two AWS environment roots are byte-identical apart from `terraform.tfvars`**, and
  `deployment/aws-tofu/check-environments-match.py` fails CI when they are not. Every
  resource belongs in `modules/environment/`; anything that must differ between `qa` and
  `prod` becomes a module variable. Never add a resource to an environment root.
- `deployment/aws-tofu/account/` is the exception, and is a root with resources in it: it holds
  what there is one of per AWS account, such as the GitHub OIDC provider. **Apply it before
  either environment** — they look the OIDC provider up by URL and cannot plan until it exists.
- **Infrastructure is applied by a human, never by CI.** The deploy identities are OIDC roles
  scoped to redeploying the application; there is deliberately no credential anywhere that can
  run `tofu apply`. `doc/decisions/deployment-and-aws.md` explains why that is a guarantee
  rather than a policy.
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
  would merge before anything had run. The `schedule` there is deliberate and
  restricts pull request *creation* only — Renovate acting outside it is
  expected, because it can be run directly from the Mend dashboard, so never
  remove it as leftover setup debris.
- The project is licensed **Apache-2.0** (`LICENSE`, verbatim). There are
  deliberately no per-file license headers — see `doc/decisions/build-and-dependencies.md`.

## Issues

- A piece of work Claude should finish without a conversation first is written with the
  **Story** issue form (`.github/ISSUE_TEMPLATE/story.yml`): what and why, **done when**,
  constraints, **decisions — yours or mine**, out of scope.
- A goal too large for one story is an **Epic** (`.github/ISSUE_TEMPLATE/epic.yml`). It is never
  implemented directly: it starts with an investigation — options compared, with references —
  whose result is a decision for Gunnar, and is then split into stories linked as sub-issues.
- **Prefer the outcome to the mechanism.** A named mechanism that turns out not to work costs a
  round trip; an outcome does not. Issue #70 asked for `Optional<T>`, which breaks the OpenAPI
  document, so the ask became a question instead of a change.
- **Say which decisions are delegated.** Ask-don't-guess above means an unmarked decision
  becomes a question and the run stops there, which is right — but most decisions do not need
  Gunnar, and saying so is what lets a story be finished in one go.
- Anything that is neither a story nor an epic — a bug, a question, a note to self — uses the blank form.
- **Every open issue carries a priority, in two places kept in step**: a label —
  `priority: 1 now` (next up, at most two or three), `priority: 2 next` (after that) or
  `priority: 3 later` (wanted, not soon) — and the same value in the *Priority* field of the
  [TaskFest project](https://github.com/users/guhilling/projects/2), whose table is grouped by
  it and ordered by hand within each group. The label is what an issue list shows and filters
  on; the project is the one place with a real order. A new issue gets both when it is opened
  (`gh project item-add 2 --owner guhilling --url …`, then `item-edit --field Priority`) —
  Gunnar's call if the priority is not obvious, so ask. "Work on the next issue" means the top
  of the project's first group. Renovate's Dependency Dashboard (#22) is the one exception.

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
