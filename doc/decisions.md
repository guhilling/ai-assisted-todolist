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

**Decision.** The backend image is built by Jib onto a pinned
`eclipse-temurin:25.0.4.1_1-jre-ubi10-minimal`. All four Dockerfiles Quarkus generated under
`backend/src/main/docker/` have been deleted, along with `backend/.dockerignore`; the
directory no longer exists.

**Why.** Jib needs no Dockerfile and no daemon-side build. The pin is not optional: Jib's
default base ships JDK 21 and the container exited silently on class file version 69.

**Why the Dockerfiles were deleted rather than left alone.** The two JVM ones were
`ubi9/openjdk-17` based, so building from either would have failed on class file version 69 in
exactly the way the pin exists to prevent — a trap for anyone who found them before finding
this page. The two native ones were no better: equally unbuilt, and **none of the four was
ever exercised by a test or by CI**, so nothing would have caught them rotting. Which is what
happened — they sat at JDK 17 while the project moved to 25. They also cost review time:
Renovate raised pull requests to advance the `openjdk-17` and `ubi-minimal` tags on files
nothing built. Verified before deleting: the only references to any of them were inside their
own comment headers, every `docker build` in the repository targets the *frontend* image, the
`native` profile also builds through Jib, and
`./mvnw package -Dquarkus.container-image.build=true` still produces the image afterwards on
the same base image digest.

**Temurin, on a Red Hat base — which is both things at once.** This entry twice said something
narrower. It first preferred UBI minimal with a JDK installed on top; then, when that was
settled, it said a plain Temurin image and not UBI. `-ubi10-minimal` is the resolution rather
than a reversal: the JRE is the same Temurin build the project compiles and tests with, so
there is still one Java version to track, and the base underneath it is Red Hat's, which is
what the preference for UBI was ever about. Installing a JDK by hand was the part worth
dropping, not the base.

**Why the tag is pinned to an exact build.** `25-jre-ubi10-minimal` moves, so two builds of the
same commit could sit on different bases and only one of them fail. `25.0.4.1_1-jre-ubi10-minimal`
does not move.

**How a pin that nobody edits stays current.** Renovate, through a custom regex manager in
`.github/renovate.json`. No built-in manager reads the value: it lives in a Quarkus properties
file, and moving it into `pom.xml` would not have helped, because the Maven manager updates
dependency versions rather than container references. The manager was checked against the real
file rather than assumed — it resolves `eclipse-temurin` and the tag, with the `docker`
datasource.

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

## The due-date rule applies to filing a task, not to changing one

**Decision.** `@FutureOrPresent` lives on `TaskCreateRequest` alone. It is gone from the
`Task` entity and absent from `TaskUpdateRequest`, so an overdue task can be edited and
completed while a new one still cannot be filed in the past.

**Why.** The old rule made a task un-editable the day after it came due. It sat on the entity
as well as the request, and Bean Validation runs on flush, so a stored task silently became
invalid as time passed — no edit required. Because the update endpoint replaces the whole task
rather than patching it, that took the state change down with it: ticking off something late,
which is the single most common thing anyone wants to do with a board, returned 400. Confirmed
by writing the test first and watching it fail with `Expected status code <200> but was <400>`.

**Why two records rather than validation groups.** `@Valid` validates the `Default` group only.
Putting `@FutureOrPresent(groups = OnCreate.class)` on a shared record and annotating `create`
with `@ConvertGroup(from = Default.class, to = OnCreate.class)` would validate the date rule and
*silently stop validating* `@NotBlank`, `@Size` and the `@NotNull`s. That failure is invisible —
the endpoint still works, it just stops rejecting rubbish. `TaskCreateRequest` and
`TaskUpdateRequest` duplicate four field declarations and cannot fail that way.

**Cost.** Two records to keep in step, and a `TaskFields` interface so `apply` still takes one
parameter type. Nothing stops a client backdating an existing task, which is a feature more
than a risk: correcting a date you typed wrong is now possible.

## The board is the front page; the project description is a link

**Decision.** The signed-out page is an app name, one sign-in button and a link to
`doc/purpose.md` on GitHub. The old hero section — the tech-stack prose and the
"Backend / Frontend / Deployment" list — is gone. Signed in, the whole page is the board.

**Why.** The front page described the repository rather than doing anything, which put the
project's own explanation in the way of the app for the person using it daily. A link serves
the visitor who wants that explanation without charging the daily user for it.

**Why only the usable provider.** `AuthProviderResource` reports `available` per provider and
`loginUrl: null` when credentials are missing. The old UI rendered those as disabled cards, so
every deployment showed a dead "Configure credentials" button — in dev, a Google card that
could never work. The frontend now filters to `available`, which in practice leaves exactly
one: the profile decides whether that is Google or the local Keycloak.

**Rejected: redirecting automatically to that single provider.** It is the obvious move once
there is only one, and it was asked for. But this repository exists to be read, and bouncing
every anonymous visitor to an identity provider leaves nowhere to say so — the purpose link
would have had to live behind the sign-in it explains. One button is one click, and the page
costs nothing.

## A checkbox for done, a quiet marker for in progress

**Decision.** The round checkbox on each row toggles `TODO` and `DONE`. `WORKING` is set from
the row's overflow menu and shows as a `doing` chip. The enum is unchanged.

**Why.** Completing a task is overwhelmingly the common action and it should cost one click; a
three-value `<select>` charged three interactions for it. `WORKING` is real but rare, so it
belongs where rare things go. Keeping it out of the checkbox also keeps the checkbox honest:
a control that does not complete on the first click is a surprise, and makes "untick" ambiguous.

**Why optimistic.** The tick is applied before the server answers and rolled back if the save
fails. A round trip is perceptible, and a checkbox that lags feels broken rather than careful.
The rollback is what keeps it safe: a rejected change never leaves the board asserting
something untrue.

**Cost.** `WORKING` is now two clicks away and less discoverable. That is the trade, and it is
the right way round.

## Due dates are relative words, set from defaults

**Decision.** Rows say `Today`, `Tomorrow`, `Yesterday`, `3 days ago`, a weekday name inside
the week, then `31 Dec`. The board groups into Overdue / Today / Tomorrow / This week / Later.
Adding a task offers `Today`, `Tomorrow`, `In 1 week` and `In 2 weeks`, and defaults to
tomorrow.

**Why.** `Due 2026-12-31` requires arithmetic to read, and "what is late and what is today" is
the only question a todo list has to answer at a glance. Typing a date was also the slowest
part of adding a task; the default means the common case needs no date interaction at all.

**Why the logic takes today as a parameter.** `dates.ts` never reads the clock. Every function
receives today as an ISO string, so a render is a pure function of its inputs and the tests
need no clock faking. Dates are anchored at UTC midnight and handled as strings, because
`new Date('2026-10-26')` in a zone behind UTC is the 25th, and day arithmetic over a
daylight-saving change is off by one — both bugs that look like correct code.

**Cost.** The board reads the clock once per mount, so one left open overnight keeps yesterday's
headings until it is reloaded. Rows silently re-sorting under the pointer would be worse.

## Compose probes live in scripts, not inline

**Decision.** A healthcheck or other multi-part command in a Compose file goes in a script
file next to it, mounted read-only, and is referenced by path:
`test: ["CMD", "bash", "/config/healthcheck.sh"]`. The same will apply to Kubernetes
`command`/`args` when that arrives.

**Why.** The first version of the backend healthcheck was written inline as a YAML folded
scalar. Compose split it on whitespace into separate argv entries, so what actually ran was
`bash -c exec` — a no-op that exits 0. The healthcheck therefore passed instantly and always,
`up --wait` returned while the backend was still booting, and the browser suite met a 502 from
nginx. The failure mode is the dangerous kind: a check that can never fail is indistinguishable
from a service that is always healthy.

**Also.** A script can be read, commented and run by hand; an inline one-liner with nested
quoting can be none of those.

**Cost.** One more file, and a volume mount that has to stay in step with it.
## Undo instead of a confirmation, and what it costs

**Decision.** Deleting a task is one click with no dialog. An offer to undo stands for eight
seconds. Undo re-creates the task through the API.

**Why not a confirmation dialog.** "Are you sure?" on every delete trains people to click
through it, so it stops protecting anything while still costing a click every time. An undo
is cheaper when you meant it and better when you did not.

**Two requests, not one.** Creating refuses a date in the past, so re-creating a task that was
already overdue would fail — and overdue tasks are exactly the ones people delete. `restoreTask`
therefore creates the task dated today and then corrects the date with an update, which does
allow the past. That asymmetry is deliberate and is the subject of its own entry above; this is
the first place it bit something other than the board.

**Cost, and it is a real one.** The task comes back with a **new id**. The server has no memory
of the old one. Nothing here refers to a task by id except the rows themselves, so the only
visible effect is where it lands among tasks that share a due date — but "undo" restoring
something that is not, strictly, the same record is worth knowing before anything starts
referring to tasks by id.

**Rejected: deferring the delete until the offer expires.** That would make undo a true cancel,
with no new id and no date repair. It was not taken because the task would still exist on the
server during the window, so a reload mid-offer resurrects something the user has already seen
disappear — a worse surprise than a changed id, and a silent one.

## Importance is a dot, and the word is still there

**Decision.** Importance renders as a dot at the head of each row's metadata line: hollow for
low, solid for medium, solid with a ring for high. The word is kept in the markup as
screen-reader-only text.

**Why.** `Importance: MEDIUM` on every row was noise on the thing people scan fastest. A dot
carries the same information in a glance and takes no width.

**Why fill as well as colour.** Colour alone fails for the colour-blind, in greyscale and in
high-contrast modes. The three levels differ in fill, so they are still three things without
any colour at all — and a screen reader gets the word rather than a decorative shape.

**Also.** `n` opens the add row from anywhere on the board, ignored while the caret is in a
field or a modifier is held, so it cannot swallow a typed letter or shadow a browser command.

## The frontend is served by Red Hat's hardened httpd

**Decision.** The frontend image is `registry.access.redhat.com/hi/httpd:2` — Apache 2.4,
non-root on port 8080 — instead of `nginx:1.31-alpine`. The published port changes with it, so
the Compose files map `3000:8080`.

**Why.** It puts both images on a Red Hat maintained base, which is the point of the change.
The image is also hardened: it runs as `apache` rather than root, and it ships **no shell at
all**. That is worth knowing before debugging one — `podman exec ... sh` does not work, and
anything the runtime needs has to be `COPY`ed in, because `RUN` has nothing to run.

**What had to be carried across.** The nginx configuration was doing four things, and each has
an equivalent that is easy to get wrong:

| nginx | httpd | why it matters |
| --- | --- | --- |
| `root` + `index` | `DocumentRoot` | — |
| `try_files $uri /index.html` | `FallbackResource /index.html` | a deep link is a route, not a 404 |
| `proxy_set_header Host $http_host` | `ProxyPreserveHost On` | the backend builds `redirect_uri` from `Host`; without it sign-in returns the browser to the backend's port |
| `proxy_buffer_size 16k` and friends | `LimitRequestFieldSize 32768` | the chunked session cookie comes back as one long `Cookie` header |

The last one is headroom rather than a fix: measured, the cookies total about 5.2 KB against
Apache's 8190-byte default, so they fit today. It is raised because the size depends on how many
claims the provider puts in the token, and the failure would be a 400 on every request after
sign-in — a symptom that points nowhere near its cause.

**Verified rather than assumed.** The whole end-to-end suite passes against the new images,
including a real Keycloak sign-in through the proxy, which is what exercises `ProxyPreserveHost`.
Separately checked by hand: a deep link returns the app, a real asset still serves, and an
unknown `/api` path returns the *backend's* 404 rather than the index page, which is what
confirms `ProxyPass` is matched before the fallback.

**Cost.** `hi/httpd:2` is a moving major tag, so Renovate will only raise a pull request when a
`3` appears. Pinning it by digest would make it as reproducible as the backend's base, at the
price of a pull request every time the image is rebuilt upstream; that is a separate decision
and has not been taken.
## Name and picture are session data, not identity

**Decision.** `/api/auth/me` returns the signed-in person's display name and picture, read
from the provider's token on each request. Neither is stored. `User` remains `id`, `email`,
`createdAt`.

**Why.** The email is what the application means by identity: it is what a `User` is keyed by
and what every ownership predicate compares. A name and a picture are how somebody is shown
their own session — provider-owned attributes that happen to travel with the token. Persisting
them would add a migration, a refresh path and a staleness problem (a Google picture URL
expires) in exchange for nothing the application currently does.

**Cost, and it is the reason to revisit.** Because nothing is persisted, a name can only be
shown to its owner. Anything that had to display one user's name to another — sharing a list,
an audit trail, an admin view — would need this decision reopened and a migration written. That
is a feature change, not an oversight.

**Consequence for scopes.** `quarkus.oidc.authentication.scopes=email,profile` is now set for
every profile rather than only dev and test, because without `profile` Google returns neither
claim. Both are non-sensitive: Google requires no verification review, and `picture` comes with
`profile` rather than being a permission of its own.

## Gravatar is asked by the backend, and that buys accuracy rather than privacy

**Decision.** When a provider supplies no picture, the backend requests the address's Gravatar
with `?d=404` and returns the URL only when one exists. SHA-256 of the trimmed, lower-cased
address; result cached; two-second timeout; a failure yields no picture rather than an error.

**Why the backend and not the browser.** The requirement was a picture "if an image is
available there", and only a request answers that. Left to the browser, the page would carry a
URL nobody had checked and fall back on a broken image — which works, but means the application
never actually knows.

**What this does not do.** It does not stop the browser contacting gravatar.com: the page still
loads the image from there, so Automattic still sees the reader's IP and a hash of their email,
and an email hash is reversible for any address somebody thinks to try. The server-side check
buys a truthful answer, not privacy. Recorded here because the opposite is easy to assume.

**Why cached, and why failure is silent.** `/api/auth/me` runs on every page load, so an
unguarded lookup would mean an outbound request on every page load. And an avatar is not worth
failing a sign-in over: if Gravatar is slow or down, the answer is "no picture" and the session
proceeds.

**Why SHA-256 rather than MD5.** Gravatar accepts both and documents SHA-256. There is no
reason to derive a public identifier from an email with a broken hash, and the normalisation —
trim, lower-case — matters more than either: get it wrong and the lookup silently returns
somebody else's avatar or nobody's, never an error.

**Rejected: initials only, no third party.** It would have removed the question entirely, and
it is what the fallback does anyway when no image exists. The issue asked for Gravatar, and the
trade is now written down rather than decided by omission.

## A task id is checked before it is put in a URL

**Decision.** `putTask` and `deleteTask` build their URL through `taskUrl`, which throws unless
the id is a safe integer, rather than interpolating whatever arrived.

**Why.** `readJson` ends with `as T`. That is an assertion, not a check, and TypeScript erases
it — so every field of every response is the right type only by claim. An `id` of
`"../../elsewhere"` or an absolute URL would have been interpolated straight into a `fetch`,
and the browser would have issued that request with the session cookie attached. SonarCloud
reports the path as API traversal and client-side request forgery.

**How much of a risk it actually was.** Small: the tainted source is this application's own
backend, and a backend able to return a malicious id can already do worse directly. The reason
to fix it anyway is that the check is three lines and the alternative is a frontend that
believes whatever it is told about where to send an authenticated request.

**It throws rather than coercing.** A task whose id is not a task id is a broken response.
Silently addressing a different task, or dropping the request, would both hide that.

**The root cause is larger and is not fixed here.** `as T` lies about every response, not just
this field. Validating response shapes properly would mean a schema library and a runtime
check at each boundary — a real change with a dependency attached, and a separate decision.
This closes the reachable sink.