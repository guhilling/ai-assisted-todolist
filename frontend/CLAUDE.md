# CLAUDE.md — frontend

Frontend-specific guidance for the React + TypeScript app under `/frontend`.
Read together with the repository root `CLAUDE.md` (ask-don't-guess, TDD,
DDD, and project context all still apply here).

## Testing strategy

- Unit tests are welcome and expected — **TDD applies to the frontend too**:
  write a failing test first, then the minimal code to make it pass, then
  refactor.
- No test framework is installed yet. Use **Vitest + React Testing Library**:
  it fits the existing Vite setup with no extra bundler config, and is the
  natural choice for a Vite-based React project.
- Use **`@vitest/coverage-v8`** to produce coverage output, feeding
  **SonarCloud** for code quality/coverage analysis (mirrors the backend's
  JaCoCo → SonarCloud setup).
- **Coverage is a gate.** `coverage.thresholds` in `vite.config.ts` fails
  `npm run test:coverage` below the minimum, and `frontend-ci.yml` runs it. The
  `include`/`exclude` there are deliberate: without them the report covers whatever the
  tests happened to import, which let `App.css` in with empty counters and left `main.tsx`
  out entirely.
- **Prefer driving the UI over calling the module functions directly.** The interaction
  tests fill the form and change the selects, so what they pin down is what a user does,
  not the shape of the API layer.

## TypeScript

- Use **strict typing wherever possible.** Enable `"strict": true` in
  `tsconfig.app.json` (currently only a handful of individual flags are set,
  not full strict mode) and avoid `any` / unchecked `as` casts as escape
  hatches.
- Prefer typing the API boundary properly rather than hand-maintained,
  possibly-drifting interfaces: consider generating request/response types
  for the todo API from the backend's OpenAPI spec (`/q/openapi`) rather than
  duplicating them by hand.

## Linting

- `oxlint` is part of the project (`npm run lint`) and is wired into
  `frontend-ci.yml` as a failing check, alongside tests/coverage. Anything
  automatable — lint, type-check, tests, coverage — should be enforced by
  the standard CI run, not left as a manual convention (same principle as
  the backend).

## Code quality tooling

- Frontend code is analyzed with **SonarCloud** (alongside the backend),
  using the Vitest coverage report as input.

## Documentation

- **TSDoc blocks on types, module-level functions and components**, following the same
  rule as the backend: the first sentence says what the thing is _for_, and a second
  paragraph carries the _why_ when there is one.
- This is **convention only, not enforced** — oxlint ships no `require-jsdoc` rule, so
  nothing will fail the build for a missing block. It depends on being remembered.
- What _is_ linted is doc-comment hygiene: `jsdoc/check-tag-names`, `jsdoc/empty-tags` and
  `jsdoc/no-blank-blocks` are errors in `.oxlintrc.json`. Deliberately not enabled are
  `jsdoc/require-param-type` and `jsdoc/require-returns-type`, which would ask for types in
  comments that TypeScript already carries.
- **Types mirroring a backend enum say so**, because the two have to change together and
  the string literals travel over the wire verbatim.
- Files whose reason for existing is a configuration subtlety — the Vite proxy, the Vitest
  setup, the Playwright config — get a file-level block explaining it, rather than a
  comment that can drift away from the line it explains.
- Anything larger than a single module belongs in `/doc`, and is updated in the same change
  as the behaviour it describes.
