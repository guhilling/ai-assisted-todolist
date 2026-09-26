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

## Mutation testing, scoped to the tests that do not boot Quarkus

**Decision.** PIT runs at `verify` over an explicit allowlist of non-Quarkus test classes,
and **reports without failing the build**. `targetClasses` stays wide, and each production
class without a fast unit test is excluded by name. The report is a CI artifact on every
backend run.

**Why.** Line coverage is at 99%, which is the point where the number stops being
informative — it says every line ran, not that anything would notice if a line changed.
PIT answers the second question.

**Why no threshold.** Every other quality check here fails the build, and this one
deliberately does not. With one production class of eight in scope, a gate would police a
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

**Cost.** The scope is honest but narrow: one production class of eight today. The
`excludedClasses` list has to be maintained, a new plain unit test is not mutated until it
is added to the allowlist, and because nothing fails, the report only has an effect if
somebody reads it.

## Apache License 2.0, as a `LICENSE` file only

**What.** The full Apache-2.0 text as `LICENSE`, verbatim from apache.org, plus a copyright
line in the README. No per-file license headers, and no enforcement of them.

**Why.** A permissive licence that grants patent rights and is well understood suits a
project whose point is to be read. The file is unmodified, including the appendix that
carries the header boilerplate template — Apache asks that the text not be altered, so the
actual copyright statement lives in the README instead of being substituted into the
appendix.

**Rejected.** Adding the boilerplate header to every `.java` and `.ts` file and failing the
build on a file without one. Every other quality convention here is enforced in CI, so this
is a genuine exception: it would touch every source file in the repository to restate
something one file already says, and this is a single-author demo project rather than a
codebase whose files get copied out individually. Also rejected, for now: a `NOTICE` file,
which matters when redistributing someone else's Apache-licensed work and there is none here.

## A release is a git tag, and the version lives nowhere else

**What.** Pushing `v1.2.3` runs `release.yml`, which builds at that version and publishes
container images tagged `1.2.3`. `backend/pom.xml` declares `<version>${revision}</version>`
and the release build passes `-Drevision=1.2.3`. No file in the repository records a release
version, before or after.

**Why.** The alternative flows all require editing a version and committing it — either by
hand before tagging, or by a workflow that rewrites `pom.xml` and `package.json` and pushes
back to `main`. The second needs a way around the `main-branch` ruleset that rejects direct
pushes, and it means a release mutates the branch it is releasing. Deriving the version from
the tag removes the bookkeeping entirely: `main` is permanently `1.0.0-SNAPSHOT` and nobody
has to remember to open the next development version.

**Why no Maven artifact.** Nothing outside this repository consumes the backend's POM, so
there is no reason to publish to a Maven repository, and the one real caveat of
`${revision}` — that an installed POM keeps the literal property unless
`flatten-maven-plugin` rewrites it — does not bite. It would have to be added if that ever
changes.

**Cost.** `latest` still means the tip of `main`, because `publish-images.yml` already
pushed it there on every merge and a release moving it would have the two workflows fighting
over one tag. That is the opposite of the usual container convention and is the single most
likely thing to surprise someone. `doc/releasing.md` says so and says where the change would
go.

## SNAPSHOT dependencies fail every build, not just releases

**What.** `requireReleaseDeps` runs at `validate` on every backend build. `requireReleaseVersion`
is release-only, in the `release` profile. The frontend's counterpart,
`scripts/check-no-prerelease-deps.mjs`, fails on a semver pre-release anywhere in
`package-lock.json`.

**Why.** The request was for a check that a release has no SNAPSHOT dependencies, and the
narrow reading would put it only in the release path. But a SNAPSHOT dependency is wrong the
moment it is added — it makes the build unreproducible immediately, and finding out at
release time means finding out when the cost of fixing it is highest. The check is cheap
enough to run always. `requireReleaseVersion` genuinely is release-only: on `main` the
version is always a SNAPSHOT, so it would fail every build.

**Why the lockfile, not `package.json`.** A caret range in `package.json` says nothing about
what a transitive dependency resolved to, and a pre-release that arrives transitively is
exactly the case worth catching.

## Renovate merges the small updates and asks about the large ones

**What.** `.github/renovate.json`. Patch, minor, digest and pin updates carry
`automerge: true`; major updates open a pull request and wait. Quarkus artifacts, React and
its type definitions, and the frontend test tooling are each grouped into one pull request.

**Why grouped.** React and `@types/react` moving separately produces a pull request that
cannot pass `tsc` on its own, and the Quarkus BOM and its extensions have to move together
by construction.

**Why `platformAutomerge: false`.** This is the subtle one. GitHub's own auto-merge, which
`platformAutomerge: true` delegates to, merges as soon as the *required* status checks pass
— and the `main-branch` ruleset requires none. It would therefore merge immediately, before
any test had run, which is the exact opposite of the intent. With it off, Renovate merges
through the API only once it has seen every check on the branch succeed. The alternative fix
is to make the checks required in the ruleset, which is a repository-settings change; until
that happens this flag is load-bearing and must not be flipped.

**Cost.** An automerged minor Quarkus upgrade goes to `main` without anyone looking at it.
That is the stated intent, and it rests on the suites actually being a gate — which they are:
coverage, Checkstyle and the end-to-end run all fail the build. It also rests on Renovate
being installed as a GitHub App on the repository; the config file alone does nothing.

**The `schedule` restricts branch creation only, and stays.** `"before 6am on monday"` limits
when Renovate *opens* pull requests, so updates arrive as one weekly batch rather than
trickling in. It does not gate merging: Renovate reports `Automerge: At any time (no schedule
defined)` in every pull request body, and an already-open pull request merges as soon as its
checks go green regardless of the day.

**A Renovate run outside that window is not a broken schedule.** The first 25 pull requests
appeared on a Saturday, which looked like the setting being ignored. It was not: Renovate can
be told to run directly from the Mend dashboard, and that is what happened. Two cheaper
explanations were checked and ruled out first — the schedule string is valid (it passes
`renovate-config-validator` as *repository* config on Renovate 44; validating the file by path
alone checks it as global config, which silently skips `schedule` and `packageRules`), and the
schedule was not suppressing automerge. So do not read off-schedule activity as a
misconfiguration, and do not remove this setting as leftover debris from the setup — it is
deliberate. The Mend job log, which is the only place that says why a given run happened, is
behind the account rather than the repository API.

## CodeQL scanning, unfiltered by path

**What.** `codeql.yml` analyses `java-kotlin` and `javascript-typescript` on every push to
`main`, every pull request, and weekly. The Java build mode is `manual`, compiling with
`-DskipTests -Dcheckstyle.skip -Dquarkus.build.skip`.

**Why unfiltered.** `backend-ci.yml` and `frontend-ci.yml` are path-filtered, which is right
for them and wrong here: the README carries a CodeQL badge, and a path-filtered workflow
makes its badge report whichever run last touched a matching directory, possibly many commits
ago. The weekly run exists because the queries improve on GitHub's side, so a scheduled scan
finds things that were not findable when the code landed.

**Why a manual build.** The extractor needs compiled classes and nothing more. Skipping
Quarkus's augmentation step and Checkstyle keeps a red CodeQL badge meaning a CodeQL finding
rather than a failure already reported by another workflow.

**Why `-Dmaven.test.skip` and not `-DskipTests`.** `skipTests` only skips *running* the
tests; `testCompile` still runs, so `backend/src/test` was compiled into the CodeQL database
and scanned. That is close to pure noise — a test's hard-coded Keycloak password is the point
of the test, not a finding — and `paths-ignore` cannot fix it, because that setting applies
only to interpreted languages. For a compiled language the scope *is* whatever the build
compiles, so not compiling the tests is the only lever.

**The query suite is `security-extended`, not `security-and-quality`.** The quality half of
that suite is maintainability and style analysis, which SonarCloud already performs on both
languages here. Running it in CodeQL as well would bury the security findings under a second
opinion on style. `security-extended` keeps CodeQL doing the one job nothing else in this
repository does.

**Note on what `configFileFound: false` means.** Every CodeQL run logs
`"configFileFound": false` against `/home/runner/.config/codeql/config`. That is the CodeQL
CLI's own per-user config file on the runner, which never exists on a hosted runner and is
not something a repository supplies. It is not a sign of a missing
`.github/codeql/codeql-config.yml`, and it still says `false` now that one exists.
