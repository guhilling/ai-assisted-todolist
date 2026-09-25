# Testing

Tests are written before the code they cover — see the `CLAUDE.md` files. This page is
about what exists and how to run it.

## The layers

| Layer | Where | Boots | Runs in |
| --- | --- | --- | --- |
| Backend unit / integration | `backend/src/test/**` | Quarkus + real PostgreSQL + Keycloak via Dev Services | `backend-ci.yml`, `sonarcloud.yml` |
| Packaged smoke test | `TaskResourceIT` | the built runner | skipped by default |
| Frontend component | `frontend/src/App.test.tsx` | jsdom, stubbed `fetch` | `frontend-ci.yml`, `sonarcloud.yml` |
| Browser end-to-end | `e2e/tests/` | the whole containerised stack | `e2e.yml` |

The backend's split between "unit" and "integration" is not about annotations but about
what a test needs: most of it needs a real database, because that is where the behaviour
being checked actually lives. H2 is deliberately not used — it does not reflect
PostgreSQL closely enough to be worth the speed.

## Backend

```bash
cd backend
./mvnw verify          # tests, JaCoCo coverage, and Checkstyle
./mvnw test            # tests only
./mvnw checkstyle:check
```

Dev Services starts PostgreSQL and Keycloak automatically, so a container engine has to be
running. Thirty-four tests across seven classes:

- **`AuthProviderMappingTest`** — the only test here that does not boot Quarkus. Provider
  availability is a decision about configuration, so feeding `AuthProvidersConfig` directly
  covers every combination of enabled/credentials/issuer in milliseconds, where a
  `@QuarkusTest` can only ever exercise the one combination its profile declares.
- **`TaskTest`** — the description length constraint, and that Hibernate populates and
  maintains the audit timestamps. Needs a real database precisely because that is engine
  behaviour.
- **`UserServiceTest`** — create-on-first-sight, across two separate transactions, because
  that is how production calls it.
- **`TaskResourceTest`** — the REST contract with identity faked by `@TestSecurity` /
  `@OidcSecurity`. Fast, and able to switch identity freely; proves nothing about sign-in.
  Covers all four verbs, the ownership 404s, due-date ordering, and every shape the
  validation constraints reject.
- **`AuthProviderResourceTest`** — with authentication off, no provider is offered as
  clickable.
- **`KeycloakLoginFlowTest`** — the real authorization code flow (see below).
- **`MetricsResourceTest`** — `/q/metrics` is actually exposed, since Micrometer
  contributes it through configuration that nothing else would notice breaking.

### The real sign-in test

`KeycloakLoginFlowTest`, with its helper `support/KeycloakLoginFlow`, is the one that
exercises the path production uses: it follows the redirect to Keycloak, scrapes the login
form's action URL, posts credentials, follows the callback, and then uses the API with the
session cookie that results. It also signs both local accounts in and proves neither sees
the other's tasks.

Two details in the helper exist because of real failures, and should not be "tidied away":

- **`urlEncodingEnabled(false)`.** The authorize URL is already percent-encoded; letting
  RestAssured encode it again produces a `redirect_uri` Keycloak rejects outright.
- **A hand-rolled cookie jar.** RestAssured's `CookieFilter` did not carry Keycloak's
  cookies across the redirects, which surfaced as "Restart login cookie not found".

### `TaskResourceIT`

Runs against the packaged artifact rather than in-JVM, and is skipped by default —
`pom.xml` sets `skipITs`, and the `native` profile turns it back on. It is thin on purpose:
`@TestSecurity` does not work outside `@QuarkusTest`, so it can only make
security-agnostic checks.

## Frontend

```bash
cd frontend
npm run test            # Vitest
npm run test:coverage   # with the lcov report SonarCloud consumes
npm run lint            # oxlint
npm run build           # tsc -b && vite build
```

`App.test.tsx` renders the app against a stubbed `fetch` and checks what the user sees in
each state: signed out, signed in with tasks, creating and moving a task, and each way the
backend can refuse. Anything needing a real session or real persistence is left to the
end-to-end suite rather than mocked more elaborately.

Two stubs live side by side. `mockFetch` routes on the URL alone; `mockApi` also routes on
the method, because create, update and list all share the `/api/tasks` URL and only the
method tells them apart.

## Browser end-to-end

Playwright against the full containerised stack, so it covers what nothing else does: real
redirects, real nginx proxying, real cookies, real persistence.

```bash
# build both images, then:
docker compose -f docker/docker-compose.e2e.yml up -d --wait
cd e2e && npx playwright test
```

Full setup is in [local-development.md](local-development.md). Useful flags while
debugging: `--headed`, `--debug`, and `npx playwright show-report` after a failure.

The suite is serial (`workers: 1`) because all tests share one database, and each account
gets its own `browser.newContext()` because Keycloak's SSO session outlives the app's
sign-out.

## Coverage

| | Measured by | Enforced by | At |
| --- | --- | --- | --- |
| Backend | `quarkus-jacoco` → `target/jacoco-report` | `jacoco:check` | `./mvnw verify` |
| Frontend | `@vitest/coverage-v8` → `coverage/lcov.info` | `coverage.thresholds` | `npm run test:coverage` |

SonarCloud reads both reports; it does not measure anything itself.

### Why `quarkus-jacoco` is not optional

The JaCoCo Maven plugin on its own reported **0% for `TaskResource`, `UserService`, `Task`
and `User`** — the four most heavily tested classes in the project — while reporting
correctly for everything else. Those four are exactly the classes Quarkus rewrites at build
time: the two Panache entities, and the two classes that touch entity fields or static
finders. They are loaded by `QuarkusClassLoader`, which the stock agent cannot instrument,
so their execution never reached the `.exec` file at all. Backend line coverage read 41%
when the real figure was 89%.

`io.quarkus:quarkus-jacoco` reports against the bytecode Quarkus actually runs. **Removing
it silently returns those four classes to zero** — the build still passes, the report still
generates, and the number just quietly drops. The Maven plugin is still present, but only
for its agent (tests that do not boot Quarkus) and its `check` goal; its `report` execution
was removed, because it would overwrite the correct report with the broken one.

Both write `target/jacoco-quarkus.exec`, which is why `quarkus.jacoco.reuse-data-file=true`
is set: without it the extension wipes what the Maven agent recorded.

If a local run shows a number you cannot explain, check the age of
`target/jacoco-quarkus.exec`. The agent appends, so a file that survives across runs without
a `clean` accumulates — the old `target/jacoco.exec` had grown to 58 MB and still held
classes deleted months earlier.

### The end-to-end suite is deliberately not counted

Nothing from the Playwright run reaches the coverage figure: the backend runs in a container
with no agent attached, and the frontend is a minified production bundle. This is a choice,
not an oversight. The e2e suite exists to prove the real stack works — real redirects, real
cookies, real persistence — and folding it into coverage would inflate the number in exactly
the way that hides missing unit tests. A line that only a browser test ever reaches is a
line with no unit test, and the number should say so.

### The thresholds

Backend 95% line / 90% branch; frontend 95% on all four counters. Each sits just below what
the suite actually achieves (98%/93% and 100%), so a genuinely defensive branch does not
fail the build on the day it is written. **Raise them when coverage rises; do not lower them
to fit a change.**

## Continuous integration

| Workflow | Runs |
| --- | --- |
| `backend-ci.yml` | style, backend tests, the coverage gate, packaging, container image build |
| `frontend-ci.yml` | install, lint, build, frontend image build |
| `e2e.yml` | builds both images, brings the stack up, runs Playwright |
| `sonarcloud.yml` | both test suites with coverage, then the Sonar scan |

`e2e.yml` uploads the Playwright HTML report as an artifact when it fails, and dumps the
Compose logs — start there rather than trying to reproduce locally.

All four are advisory: `main` requires a pull request, but no status check is required to
merge. Do not treat a red build as optional anyway.
