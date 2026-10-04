# Testing

## Quarkus Dev Services, not hand-rolled Testcontainers

**Decision.** PostgreSQL and Keycloak in dev and test come from Dev Services, driven by
*leaving* the datasource URL and issuer unset.

**Why.** Quarkus's own test support over bespoke test infrastructure, per
`backend/CLAUDE.md`. It also means `./mvnw quarkus:dev` boots the entire local stack in one
command with no credentials of any kind.

**Cost.** A container engine is now required to run the backend tests at all, and the
Keycloak container needs more memory than a default Podman machine provides.


## Testing sign-in through the real code flow

**Decision.** `KeycloakLoginFlowTest` drives the actual authorization code exchange rather
than injecting a bearer token.

**Why.** The BFF cookie path *is* the thing most likely to break, and injecting a token
would test a path production never takes. It immediately earned its keep: it uncovered the
broken `id-refresh-tokens` session strategy, which made every request after a successful
sign-in return 401.


## Coverage is measured by `quarkus-jacoco`, and gates the build

**Decision.** The `quarkus-jacoco` extension produces the coverage report; the
`jacoco-maven-plugin` keeps only its agent and its `check` goal, which fails `verify` below
95% line / 90% branch. The frontend equivalent is `coverage.thresholds` in `vite.config.ts`.

**Why.** The Maven plugin alone reported 0% for `TaskResource`, `UserService`, `Task` and
`User` while reporting correctly for everything else — they are the classes Quarkus rewrites
at build time, loaded by `QuarkusClassLoader`, which the stock agent cannot instrument. That
put backend line coverage at 41% when it was really 89%. A silently wrong number is worse
than no number, because it invites work on the wrong problem.

**Cost.** Two tools now share `target/jacoco-quarkus.exec`, which needs
`quarkus.jacoco.reuse-data-file=true` so the extension does not wipe what the agent wrote.
The plugin's `report` execution had to go, because it would overwrite the good report with
the broken one. Removing the extension breaks nothing visibly and halves the number.


## The end-to-end suite contributes no coverage

**Decision.** Only the backend test JVM and the Vitest run feed the coverage figure. The
Playwright suite is not instrumented, and there are no plans to instrument it.

**Why.** Coverage is a question about unit and integration tests. The e2e suite exists to
prove the real stack works — real redirects, real cookies, real persistence — and folding it
in would inflate the number in exactly the way that hides a missing unit test. A line only a
browser test reaches is a line with no unit test, and the number should say so.

**Rejected.** Attaching a JaCoCo agent to the e2e backend container and merging the dump,
and instrumenting the frontend bundle with istanbul to collect `window.__coverage__`. Both
work; neither tells us anything we want to act on.


## Mutation testing, scoped to the tests that do not boot Quarkus

**Decision.** PIT runs at `verify` over an explicit allowlist of non-Quarkus test classes,
and **reports without failing the build**. `targetClasses` stays wide, and each production
class without a fast unit test is excluded by name. The report is a CI artifact on every
backend run.

**Why.** Line coverage is at 99%, which is the point where the number stops being
informative — it says every line ran, not that anything would notice if a line changed.
PIT answers the second question.

**Why no threshold.** Every other quality check here fails the build, and this one
deliberately does not. With three production classes of ten in scope, a gate would police a
corner of the codebase while implying the whole of it was covered — a worse signal than an
honest report that says plainly how narrow it is. Revisit if the scope widens.

**Rejected.** Running PIT across the whole suite. It does not work, rather than merely
running slowly: PIT gives each mutant a fresh minion JVM, a `@QuarkusTest` there means a
full boot with its own Dev Services containers, and `KeycloakLoginFlowTest` cannot start
its containers in a minion at all — so the run aborts before mutating anything, because PIT
requires a green suite. Also rejected: reshaping `TaskResource` and `UserService` behind
Quarkus-free seams to widen the scope. That is the standard advice, but it changes
production code to suit a tool, and this codebase deliberately keeps its persistence logic
where it is.

**Cost.** The scope is honest but narrow: three production classes of ten today. The
`excludedClasses` list has to be maintained, a new plain unit test is not mutated until it
is added to the allowlist, and because nothing fails, the report only has an effect if
somebody reads it.

