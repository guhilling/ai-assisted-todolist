# CLAUDE.md

Guidance for Claude Code when working in this repository.

The rules this repository shares with Gunnar's other repositories — asking instead of guessing,
the pull request workflow and its reviews, branches, `/doc` and its chapters, secrets, Renovate,
issues, TDD and existing tests — come from the `conventions` plugin of
[dev-conventions](https://github.com/guhilling/dev-conventions/blob/main/plugins/conventions/rules.md),
which `.claude/settings.json` turns on, pinned to a tag. Its SessionStart hook puts them into
every session's context. This file holds what is particular to this repository, and wins where
the two differ. A cloud session on claude.ai/code does not load the plugin; `doc/purpose.md`
says what that leaves.

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

In this repository, stopping to ask applies especially to:

- Domain rules and business logic for the todo model (states, transitions,
  validation rules).
- Auth/OIDC provider behavior and configuration.

## Workflow

- The `main-branch` ruleset enforces that every change reaches `main` through a pull request,
  and rejects direct pushes. No approving review is required, so you can merge your own pull
  request once CI is green.
- **The pull requests that get `/code-review high` also get one CodeRabbit review, requested by
  hand** once `/code-review high`'s fixes are pushed: a comment `@coderabbitai review` (`gh pr comment <n> --body "@coderabbitai review"`).
  `.coderabbit.yaml` keeps it from reviewing on its own, because a review on every push of every
  pull request, Renovate's included, is what used up Copilot's monthly quota before. What it looks
  for is in `.github/REVIEW.md`, alongside the CLAUDE.md files it reads. Its findings
  are gone through with Gunnar one by one, like any other review's, and need not hold up the merge.
- `/doc` is the source of truth because the README had already drifted into documenting
  endpoints and task states that no longer existed.
- **A decision is recorded in `doc/decisions/`** with a status line under its heading (date,
  issues, `Accepted`); one that is revised is marked `Superseded · by …`, keeps a short summary
  and gets a new section, rather than being edited in place. `doc/decisions/index.md` says how, and
  CI checks it.
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
  rather than a policy. The plugin's `plan-only.py` hook refuses `tofu` commands that would
  change infrastructure or its state; it does not recognise `env.sh`.
- **Never hand-edit a version.** A release is a git tag (`v1.2.3`); the
  backend's `pom.xml` carries `${revision}` and the release build overrides it
  from the tag. `main` stays `1.0.0-SNAPSHOT` permanently, and the frontend's
  `package.json` version is unused because the package is never published.
  `doc/releasing.md` has the whole procedure.
- **A SNAPSHOT dependency fails every backend build**, not just a release
  (`requireReleaseDeps` at `validate`); the npm counterpart is
  `npm run check:deps` in `frontend/`. Do not move either into a release-only
  path — the point is to fail when the dependency is added.
- Renovate's configuration is `.github/renovate.json`, and `main` requires no status checks
  because the `main-branch` ruleset names none. Renovate also moves the plugin's tag in
  `.claude/settings.json`.
- The project is licensed **Apache-2.0** (`LICENSE`, verbatim). There are
  deliberately no per-file license headers — see `doc/decisions/build-and-dependencies.md`.

## Issues

- The GitHub project that holds the priorities is the
  [TaskFest project](https://github.com/users/guhilling/projects/2), number 2
  (`gh project item-add 2 --owner guhilling --url …`). Renovate's Dependency Dashboard (#22) is
  the one issue without a priority.

## Development methodology

- TDD holds for both backend (JUnit/Quarkus test framework) and frontend (whatever test runner
  is configured) work, and the code's own documentation that is part of each change is its
  TSDoc or Javadoc.
- **DDD for planning.** When planning a feature or change, think in terms of
  the domain first: ubiquitous language, entities, value objects, aggregates,
  and bounded contexts, before jumping to REST endpoints, database schema, or
  UI components. Surface domain modeling questions to Gunnar rather than
  assuming an answer.
