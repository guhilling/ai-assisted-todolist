# Testing

Tests are written before the code they cover — see the `CLAUDE.md` files. This page is
about what exists and how to run it.

## The layers

| Layer | Where | Boots | Runs in |
| --- | --- | --- | --- |
| Backend unit / integration | `backend/src/test/**` | Quarkus + real PostgreSQL + Keycloak via Dev Services | `backend-ci.yml`, `sonarcloud.yml` |
| Packaged smoke test | `TaskResourceIT` | the built runner | skipped by default |
| Frontend unit | `frontend/src/dates.test.ts` | nothing; pure functions | `frontend-ci.yml`, `sonarcloud.yml` |
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
running. Fifty-two tests across ten classes:

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
- **`AuthProviderResourceTest`** — with authentication off, no provider is offered as usable.
- **`AuthResourceTest`** — what `/api/auth/me` tells the browser when the provider supplied a
  name, a picture, both or neither. Faked claims are the point: a real login could only ever
  exercise whatever the identity provider happens to put in its token.
- **`GravatarUrlTest`** and **`GravatarServiceTest`** — the address derived from an email, and
  the probe that decides whether a picture is there. The second runs against a local
  `HttpServer` rather than gravatar.com, so it can exercise 200, 404, a server that never
  answers and an interrupted lookup without depending on the internet.
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

`App.test.tsx` renders the board against a stubbed `fetch` and checks what the user sees and
does in each state: signed out, signed in, adding, completing, deleting, clearing, and each
way the backend can refuse. `mockApi` routes on the method as well as the path, because list,
create, update and delete all share the `/api/tasks` URL and only the method tells them apart.

Two details are deliberate:

- **Fixture dates are computed from the real today**, not hardcoded. The board reads the clock
  once on mount and groups rows by how far away they are, so a fixed date would change which
  section a row lands in as time passed, and the suite would rot quietly.
- **The loading-state test holds the board's own fetch open** rather than letting the stub
  resolve straight away. Loading is transient, and asserting it against an immediate stub is a
  race that passes on timing rather than on behaviour — it did, until it did not.

`dates.test.ts` covers the due-date logic directly rather than through the DOM. It is the only
pure logic in the frontend and the only place an off-by-one can hide: "Today", "Tomorrow", a
weekday name and a plain date are each one day apart. It includes a daylight-saving case,
because building a `Date` from `yyyy-mm-dd` at local midnight gets the answer wrong by a day
across a clock change — which is why every function there takes today as an argument and
anchors its arithmetic at UTC.

## Browser end-to-end

Playwright against the full containerised stack, so it covers what nothing else does: real
redirects, real httpd proxying, real cookies, real persistence.

```bash
# build both images, then:
docker compose -f deployment/docker/docker-compose.e2e.yml up -d --wait
cd e2e && npx playwright test
```

Full setup is in [local-development.md](local-development.md). Useful flags while
debugging: `--headed`, `--debug`, and `npx playwright show-report` after a failure.

The suite is serial (`workers: 1`) because all tests share one database, and each account
gets its own `browser.newContext()` because Keycloak's SSO session outlives the app's
sign-out.

Two things in here exist because of failures that only a real stack produces:

- **`up --wait` needs the backend healthcheck** in `docker-compose.e2e.yml`. Without one,
  Compose calls a container ready the moment it runs, and the backend takes over thirty
  seconds to start — so Playwright met a 502 from httpd. The probe lives in
  `e2e/backend-healthcheck.sh` rather than inline, because an inline command is split on
  whitespace into separate argv entries: the first version became `bash -c exec`, a no-op
  that always succeeded, which looks exactly like a service that is always healthy.
- **A reload has to wait for the save it is testing.** Ticking a task and deleting one are
  both optimistic — the board updates before the server answers — so `page.reload()` fired
  while the request was still in flight and cancelled it. The specs now await the `PUT` and
  `DELETE` response before reloading. It passed against a warm backend, where the request
  takes milliseconds, and failed against a cold one.

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

## Mutation testing

Coverage says a line ran. Mutation testing asks a harder question: if that line were
changed, would any test notice? PIT compiles small changes into the bytecode — negate a
condition, return null, swap a boolean — and reports which ones no test caught.

```bash
cd backend
./mvnw verify                                     # runs it as part of the normal build
./mvnw org.pitest:pitest-maven:mutationCoverage   # just this, about 2 seconds
open target/pit-reports/index.html                # which mutants survived, line by line
```

Currently **21 mutants, all killed**. Every kill names the test that caught it, so the
report doubles as evidence that the plain unit tests are doing real work rather than merely
executing lines.

**This one reports; it does not block.** Unlike the coverage gates there is no threshold,
because three production classes of ten are in scope: a gate there would police a corner of
the codebase while saying nothing about the other seven, which is a worse signal than an
honest report. `backend-ci.yml` uploads `pit-report` as an artifact on every backend run, so the
result is readable without running anything locally. Revisit the decision if the scope
widens.

### PIT cannot run a `@QuarkusTest`

This is the constraint that shapes everything else. PIT runs each mutant in a fresh minion
JVM, so a `@QuarkusTest` in scope means a full application boot — with its own Dev Services
PostgreSQL and Keycloak containers — per mutant. Measured on this codebase:

| Scope | Result |
| --- | --- |
| `AuthProviderResource`, covered by a plain unit test | 10 mutants, 2 seconds, all killed |
| `UserService`, covered by a `@QuarkusTest` | 14 mutants, **163 seconds**, most minions timed out |
| One lightweight `@QuarkusTest` allowed into scope | coverage calculation goes from under 1s to **24s** |
| The whole suite in scope | **aborts before mutating anything** — `KeycloakLoginFlowTest` cannot start its containers inside the minion, and PIT requires a green suite |

Worth knowing: PIT counts a timed-out or errored minion as a killed mutant, so the
`@QuarkusTest` run reported "100% killed" while actually proving nothing. A mutant that
merely stops the application booting scores the same as one a test genuinely caught. This
is why the scope is narrow rather than merely slow.

### The allowlist, and the pressure it applies

`targetTests` names the non-Quarkus test classes explicitly instead of matching a pattern,
because that way the failure mode is benign: a new plain unit test is simply not mutated
until it is listed, whereas a pattern that swept in a new `@QuarkusTest` would make every
run minutes slower without saying so.

`targetClasses` stays deliberately **wide**, and the production classes with no fast unit
test are excluded one line at a time in `excludedClasses`. So a new production class is in
scope by default and shows up in the report as uncovered mutants instead of being silently
absent — deleting the `AuthResource` exclusion, for instance, adds eight `NO_COVERAGE`
mutants and takes the reported score from 100% to 56%.

Being wide informs rather than enforces, since nothing fails. It only works if somebody
reads the report, which is why it is uploaded as an artifact rather than left in `target/`.

The exclusion list is therefore a to-do list, and it has been collected on: `service.*`
narrowed to `service.UserService*` when `GravatarUrl` and `GravatarService` earned plain unit
tests, taking the run from 10 mutants to 21 and all of them killed. Every remaining line is a
class whose behaviour is only pinned down by tests too heavy to mutate, and deleting a line is
the reward for writing a fast one — remembering to add the new test to `targetTests`, or it is
written but never used.

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
