# Decisions

Decisions with consequences, why they were taken, and what was rejected. Newest last.

## Panache active-record entities

**Decision.** Entities extend `PanacheEntityBase`, expose public fields and carry their own
queries. No repository layer.

**Why.** It is the idiomatic Quarkus style, and Hibernate rewrites field access into
accessor calls at build time, so the public fields are not the encapsulation hole they look
like. A repository layer over two entities would be ceremony.

**Cost.** Checkstyle's `VisibilityModifier` check had to be switched off, and the domain
objects know about persistence.

## Liquibase, not Hibernate-managed schema

**Decision.** `quarkus.hibernate-orm.schema-management.strategy=validate`, with Liquibase
changelogs applied at startup.

**Why.** Schema changes should be reviewable artifacts checked in beside the code that
needs them, and the application should fail fast on a schema it does not recognise rather
than quietly adapting. The `todoitem` → `task` rename is the case that proves the point —
Hibernate would have created a second table and left the first.

**Rejected.** `import.sql` plus a generated schema, which was the starting point.

## Backend-for-frontend authentication

**Decision.** The backend is the OIDC client; tokens live in the encrypted `q_session`
cookie and never reach the browser.

**Why.** Tokens in browser storage are the part of the alternative design that goes wrong,
and a cookie session is less machinery for a single-origin app.

**Cost.** Sign-in must be a full-page navigation, `fetch` calls need
`X-Requested-With` so they get a 401 rather than a redirect, and both proxies must preserve
the `Host` header. See [authentication.md](authentication.md).

## One OIDC tenant, switched per profile

**Decision.** A single `quarkus.oidc.*` tenant pointed at Google in production and at a
local Keycloak in dev and test, rather than Quarkus OIDC multi-tenancy.

**Why.** The two never need to be live at the same time, and multi-tenancy would add
configuration surface for no gain.

## Provider availability comes from configuration

**Decision.** `/api/auth/providers` marks a provider usable because configuration supplied
a client id and secret — no provider name appears anywhere in the code.

**Why.** It was previously a hard-coded `equals("google")`, which meant the UI advertised
three providers that could never work, and meant adding one was a code change. Now a
provider is a configuration block, and a credential-less provider renders disabled, which
is also exactly what a fresh production deployment should show.

**Cost.** `AuthProviderResourceTest` had to change with it.

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

## Jib with a pinned Java 25 base image

**Decision.** The backend image is built by Jib onto `eclipse-temurin:25-jre`. The
Dockerfiles Quarkus generates under `backend/src/main/docker/` are unused.

**Why.** Jib needs no Dockerfile and no daemon-side build. The pin is not optional: Jib's
default base ships JDK 21 and the container exited silently on class file version 69. The
generated Dockerfiles are JDK 17 based and would fail the same way.

**Open.** `backend/CLAUDE.md` still expresses a preference for UBI minimal with Temurin
installed explicitly. The current pin is a plain Temurin image; revisit when the deployment
target is settled.

## sun_checks with documented relaxations

**Decision.** Checkstyle's `sun_checks.xml` as the style baseline, with a short list of
relaxations recorded in the header of `backend/checkstyle.xml`, and type-level Javadoc
required via `MissingJavadocType`.

**Why.** A standard ruleset beats a bespoke one, and the relaxations that remain each have
a stated reason rather than being silently dropped. Per-member Javadoc stays optional
because it fights JAX-RS and CDI code; type-level Javadoc is required because "what is this
type for?" is the question that code cannot answer for itself.

## Compose files under `docker/`

**Decision.** Both Compose stacks moved from the repository root into `docker/`, each with
an explicit `name:`.

**Why.** Deployment artifacts get a home before AWS material arrives. The explicit project
names are load-bearing: Compose otherwise derives the name from the containing directory,
which would have renamed the PostgreSQL volume and left the existing one orphaned, and
would have had the two stacks treat each other's containers as orphans.

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
