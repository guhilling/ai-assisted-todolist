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

- `oxlint` is already part of the project (`npm run lint`) but not yet wired
  into `frontend-ci.yml` as a failing check. Anything automatable — lint,
  type-check, tests, coverage — should be enforced by the standard CI run,
  not left as a manual convention (same principle as the backend).

## Code quality tooling

- Frontend code is analyzed with **SonarCloud** (alongside the backend),
  using the Vitest coverage report as input.
