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
- **Prefer driving the UI over calling the module functions directly.** The interaction tests
  tick checkboxes and use the add row, so what they pin down is what a user does, not the
  shape of the API layer.
- **`dates.ts` is the exception, and is tested directly.** It is the only pure logic here and
  the only place an off-by-one hides. Every function takes today as an ISO string rather than
  reading the clock, so a render is a pure function of its inputs and no test fakes a clock.
  Keep it that way, and keep the arithmetic anchored at UTC midnight: `new Date('2026-10-26')`
  is the 25th west of UTC, and day arithmetic across a daylight-saving change is off by one.
- **Test fixtures compute dates from the real today**, never hardcode them. The board groups
  rows by how far away they are, so a fixed date changes section as time passes.
- **Do not assert a transient state against an immediately-resolving stub.** The loading test
  holds the board's fetch open on purpose; the version that did not was a race that passed on
  timing.
- **Optimistic updates need the board gated on its first load.** The list response replaces the
  whole array, so anything added or ticked while it was still in flight was silently discarded.
  Nothing is interactive until `loading` is false. Mock-driven tests answer instantly and can
  never show this; the browser suite against a slow backend did.

## Module layout

- `api.ts` holds the wire: the types the backend speaks, the URLs, and every `fetch`. It is the
  only place that knows a request shape.
- `dates.ts` holds due-date arithmetic and the words the board puts on screen.
- `App.tsx` holds state and composition, and nothing else.
- `components/` holds the pieces. They take callbacks and data; none of them fetches.
- This split replaced a single 413-line `App.tsx`. Its own header comment had named the API
  functions as the seam to cut first, which is where the cut was made.

## Accessibility

- **An icon that carries meaning keeps its word**, in a `.visually-hidden` span. The importance
  dot is the example: sighted users get the dot, screen readers get "High".
- **Never encode meaning in colour alone.** The importance levels differ in fill — hollow,
  solid, ringed — so they survive greyscale, colour blindness and high-contrast modes.
- **Prefer a real control to a styled one.** The row checkbox is an `input type="checkbox"` and
  the row menu a `<details>`, so keyboard handling and roles come for free.
- **A keyboard shortcut must not swallow typing.** The `n` shortcut ignores events whose target
  is inside an `input`, `textarea`, `select` or `[contenteditable]`, and any event with a
  modifier held.

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
