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

## Tearing an environment down is a parameter, not a destroy

**Decision.** Each environment has a `running` variable, default `false`. The resources that bill
live in `modules/environment/billable.tf`, each carrying `count = var.running ? 1 : 0`, so taking
an environment down is `tofu apply` with the variable false. `deployment/aws-tofu/env.sh` wraps
the two pieces of ceremony — the right AWS profile and the right variable — and
`check-billable-guard.py` fails the build on an unguarded resource in that file.

**Why not a separate root for the billable layer.** That was the alternative, and its appeal is
real: `tofu destroy` in a runtime root cannot reach the foundation, so there is nothing to aim.
It was rejected on two grounds. The environment roots have already been applied, so splitting
them now means migrating state keys on a live environment. And a parameter is the mechanism this
directory already uses for the only other axis it has — the difference between qa and prod — so
teardown becomes the same kind of reviewable change rather than a second concept.

**Why the default is `false`.** The cost model is that an idle environment costs nothing, so the
safe outcome of an apply nobody thought hard about should be a foundation and no bill. Defaulting
to `true` would mean the careless path is the expensive one.

**Why it is never committed to `terraform.tfvars`.** Whether an environment is up right now is a
fact about the world, not about the configuration. Committing it would make every teardown a
commit, and every `git pull` a potential surprise about what exists in AWS.

**Why the guard is checked rather than remembered.** A billable resource added without `count`
fails silently: the teardown succeeds, that one resource keeps running, and the first evidence is
the bill. That is exactly the class of mistake worth spending a check on, and the check is a
deliberately literal string match — a cleverer equivalent it cannot recognise is still something
a human has to reason about, which is what the rule exists to avoid.

**On the script.** It exists because the ceremony is two things that are quiet when wrong, not
because `tofu` is hard. It deliberately shows the plan and waits on every run, and applies the
saved plan file rather than re-evaluating, so what is applied is what was displayed. A script that
applied without showing would be how an environment gets destroyed by muscle memory.

## Deploy identities are OIDC roles, scoped to deploying and nothing else

**Decision.** GitHub Actions deploys each environment by assuming an IAM **role** through GitHub's
OIDC provider. The roles may register a task definition, update the one service, run the migration
task and write the site bucket. They may not create, change or delete any infrastructure. A human
with their own privileges creates the VPC, the database, the load balancer and the cluster.

**Why the scope stops at deploying.** A credential that can run `tofu apply` needs create *and
delete* on every resource the configuration manages, which is administrator for that environment
under a different name — there is no useful way to least-privilege it. Keeping infrastructure in
human hands means that credential is never created, which is a guarantee rather than an argument.
It also matches exposure to blast radius: the deploy identity is the one used unattended and
frequently, so it is the one most likely to be abused, and scoped this way the worst case is a bad
deployment rather than a dropped database.

**Why roles and not users with access keys.** This reverses the earlier plan. An access key is a
long-lived secret stored in GitHub; an OIDC role issues credentials that expire in minutes and
stores nothing, so there is no key to leak and no rotation to schedule. It also lets the trust
condition name the GitHub *environment* as well as the repository, which turns the prod approval
gate into an AWS refusal instead of only a GitHub courtesy. A secondary benefit: `aws_iam_access_key`
writes its secret into OpenTofu state in cleartext, and with roles the question does not arise.

**Two limits, recorded rather than discovered later.**

- `ecs:RegisterTaskDefinition` cannot be scoped to a resource, because the call creates one and
  there is no ARN or tag to condition on. The qa role can therefore register a revision in prod's
  task definition family. This is accepted: a task definition nobody runs is inert, and both calls
  that could run or deploy one are scoped to this environment's cluster and service. It does mean
  the earlier plan's "denied everything tagged `env=prod`" is not literally achievable.
- The policy scopes by **explicit ARN**, not by resource tag. With each identity touching a
  handful of resources whose names the project chooses, ARNs are both tighter and simpler. A
  tag-based `Deny` was considered and rejected as theatre: every other statement is already
  ARN-scoped to one environment, and the one statement that is not has no resource to carry a tag.

**One consequence for how the code is written.** The policy names resources that do not exist yet —
the cluster, the service, the migration task family, the site bucket. It can do so because those
names are *chosen* rather than generated, so they live in a `locals` block that the changes
creating those resources must also use. CloudFront is the exception: a distribution's id is
generated by AWS, so `cloudfront:CreateInvalidation` is deliberately absent until the change that
creates the distribution can scope it to a real ARN, rather than being granted on `*` in advance.

## OpenTofu rather than Terraform

**Decision.** The AWS infrastructure under `deployment/aws-tofu/` is OpenTofu. The binary is
`tofu`, CI pins 1.12.6, and `required_version` is `>= 1.10`.

**Why.** The choice was made after comparing the two, and the honest summary is that Terraform
was the safer default and lost on two specific features:

- **A backend block can interpolate a variable** (OpenTofu 1.8). Terraform evaluates nothing in
  a backend block, so the state key has to be written out per environment. That made `backend.tf`
  the one file the environment roots could not share, and so the one exception
  `check-environments-match.py` had to carve out. On OpenTofu the roots are identical apart from
  `terraform.tfvars`, and the exception is gone — which matters because *prod is a parameter
  change from qa* is the design of that directory, and every exception is somewhere drift can
  hide.
- **The S3 backend locks using S3** (OpenTofu 1.10), so there is no DynamoDB table to create,
  pay for, or forget when tearing an environment down. The bootstrap is one bucket.

Licensing was the reason to look, not the reason to switch. OpenTofu is MPL-2.0 where Terraform
is BUSL-1.1, but BUSL only forbids offering a competing infrastructure-as-code product; using it
to manage your own infrastructure is unrestricted, and neither licence touches this repository's
own Apache-2.0.

**What it costs, stated rather than discovered later.** Terraform is what a commercial project is
more likely to use, and this environment is partly a proof-of-concept for one — so HCP Terraform,
Stacks and Sentinel are all out of reach, and documentation for awkward edge cases is thinner.
The languages and the provider protocol are the same, so the knowledge transfers; the tooling
around them does not entirely. Two further notes: state files stay compatible in both directions
*unless* OpenTofu's state encryption is enabled, which is a one-way door and is not used here;
and file names stay `.tf` and `terraform.tfvars` rather than OpenTofu's optional `.tofu`
extension, because every example and every provider document is written that way.

## Compose files under `deployment/docker/`

**Decision.** Both Compose stacks moved from the repository root into `docker/`, each with
an explicit `name:`, and later into `deployment/docker/` when the AWS material arrived and
needed a sibling.

**Why.** Deployment artifacts get a home before AWS material arrives. The explicit project
names are load-bearing, and became more so with the second move: Compose otherwise derives
the project name from the containing directory, so without them the move would have
renamed the PostgreSQL volume and orphaned the existing one, and would have had the two
stacks treat each other's containers as strays. As written, the directory can move again
and the volumes do not notice.

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

**The root cause is larger and was not fixed here.** `as T` lies about every response, not just
this field. It is fixed by the next decision; the guard in `taskUrl` stays anyway, because
`putTask` and `deleteTask` take a `Task` from a caller and a caller can build one.

## Responses are validated against the schema the backend publishes

**Decision.** `api.ts` declares none of the shapes it receives. The types and the runtime
validators are both generated from `doc/api/schema/*.schema.json` by `npm run generate:api`,
and every response is checked before anything reads a field off it.

**Why.** `readJson` used to end with `as T`, which TypeScript erases — so every field of every
response was the right type by claim only. SonarCloud reported one consequence of that as
client-side request forgery, and the rule's own mapping says what to do about it: CWE-20 and
ASVS 5.1.4, *validate structured data against a defined schema*. Not encode the output, which
is what the previous attempt did.

**Why generated rather than a schema written by hand.** A hand-written validator is a second
description of the same shape, and `api.ts` already had the first: its `TaskState` and
`TaskImportance` carried comments saying the backend's enums and these "must be changed
together". That is a convention that depends on being remembered. The backend publishes the
schemas already (see `architecture.md`), so the frontend can check against the definition
instead of against a copy of it.

**Why Ajv compiled ahead of time.** Ajv's standalone mode turns a schema into ordinary
JavaScript at build time, so `ajv` stays a devDependency and `dependencies` remains React
alone. The generator *asserts* this rather than hoping for it: if the compiled output ever
needs an `import` at runtime, it fails and says so.

That assertion is why only the three response shapes get validators. Adding the request
schemas pulls in `maxLength`, whose compiled form needs a helper from `ajv` — and the requests
do not need checking here anyway, because the backend validates what it is sent and answers
400.

**Why `format: date` is a regular expression.** `ajv-formats` would be an import at runtime for
one format. A RegExp is inlined. It checks the shape and the ranges but not the calendar, so
`2026-02-30` passes — a due date that cannot exist is a backend bug that shows as an odd label,
not something a malformed response could exploit.

**Why a checked response is copied rather than returned.** `toTask` builds a new object, with
`id: Number(data.id)`. Past that point the id is a number because a check said so and `Number`
produced it. It is also where the safe-integer test belongs, because the schema cannot express
it: `format: int64` describes a range JavaScript has no exact numbers for.

**Extra fields are allowed, deliberately.** The schemas do not set
`additionalProperties: false`. A backend that starts sending a new field must not break a
frontend deployed before it; the parsers copy the fields the contract names and ignore the
rest.

**Rejected: zod or valibot.** Either would mean a runtime dependency and a third description
of the shape — hand-written schemas, derived types — which is the thing being removed. Ajv
consumes the published JSON Schema directly.

**Rejected: marking the SonarCloud finding a false positive.** It would have been defensible.
`Number.isSafeInteger` did reject every hostile value, and the finding is the engine failing to
recognise a guard rather than a reachable flaw. It was rejected because the rule was pointing
at something true: the frontend believed whatever it was told about every field, not just this
one.

## The runner is pinned, so an image migration is a decision

**Decision.** Every `runs-on` in `.github/workflows/` names `ubuntu-24.04` rather than
`ubuntu-latest` — 13 entries across 10 files.

**Why.** `ubuntu-latest` began annotating every run with notice that the label migrates to
Ubuntu 26 on 19 October 2026. Riding that would have changed the image under every job on a date
nobody here chose, and a build that breaks because its runner moved is a confusing failure: the
commit that reveals it is unrelated to the cause.

**It does not become a manual chore, which was the obvious objection.** Renovate's
`github-actions` manager — already the one updating `actions/*` here — extracts a runner label as
a `github-runner` dependency. So `ubuntu-26.04` arrives as a pull request, and because 24 → 26 is
a *major* update, `.github/renovate.json` makes it wait for a human rather than automerging. The
pin turns the migration from something that happens into something that is approved.

**Rejected: pinning only the workflow that raised the notice.** The notice was on all 13 entries,
not on one. Pinning one would have left the other nine files riding a label whose meaning changes,
and made the pinned one look like an exception with a forgotten reason.

## Pages deploys only from `main`

**Decision.** `pages.yml`'s deploy job is guarded with `if: github.ref == 'refs/heads/main'`, and
the workflow does **not** subscribe to `release: published`. `release.yml` asks it to run instead,
with `gh workflow run pages.yml --ref main`, once the release exists.

**Why.** The `github-pages` environment carries a deployment branch policy permitting the single
branch `main`, so a deployment from any other ref is refused before its first step. Two things
follow, and the second was a real bug.

A `workflow_dispatch` on a branch — the only way to exercise this workflow, since none of its
triggers is `pull_request` — used to fail on the deploy job. Now it builds the site and skips the
deployment, so a change to the workflow can be checked without leaving a red run behind.

**A tag is not `main`.** A `release: published` event runs with `github.ref` set to
`refs/tags/v1.2.3`, so the release-triggered deployment would have been refused too — the
published `/api/v1.2.3/` would never have appeared, and nothing would have found that out until
the first release. Dispatching on `main` keeps every deployment coming from `main`, and by then
the tag is in history, so `build-api-site.py` sees the new version anyway.

**Why guard the job as well, when the environment already refuses it.** So the refusal is a
deliberate skip with a reason in the file, rather than a red run whose cause is a setting in the
repository's web UI.

## The database defines the enums, and the changelogs were squashed to say so

**Decision.** `state` and `importance` are native PostgreSQL enum types, `task_state` and
`task_importance`, created in `001-baseline.xml`. That file is the whole schema as one
changelog, replacing the three that had built it up.

**Why an enum type rather than `VARCHAR`.** The column was `VARCHAR(16)` with no constraint, so
the database would have accepted `'BANANA'`. What stood between it and a bad value was Jackson's
deserialisation, Bean Validation, and the frontend's generated schema — all of them in the
application. That is fine while this application is the only writer, and it stops being fine the
moment anything else writes: a SQL client, a fix applied by hand, a second service. A column
whose legal values are written down in the database does not depend on who is doing the writing.

**Why the changelogs were squashed.** The sequence was todoitem, then app_user, then the
replacement of todoitem by task. No database it applied to outlived it — every environment here
is built from scratch — so the only thing the history added was having to read three files to
learn the shape of two tables. It cost a one-off reset, which `local-development.md` records,
because Liquibase refuses to run against a `databasechangelog` naming changesets that no longer
exist.

**What the mapping needs, and why both halves.** `@JdbcTypeCode(SqlTypes.NAMED_ENUM)` makes the
driver send the enum rather than a `varchar` parameter, which PostgreSQL will not assign to an
enum column without a cast. `@Column(columnDefinition = "task_state")` names the type, because
Hibernate otherwise derives it from the Java class and looks for `taskstate`. Neither is
optional, and dropping either leaves an application that still compiles.

**The cost, stated rather than discovered.** Adding a value later is a new changeSet with
`ALTER TYPE ... ADD VALUE`, which PostgreSQL allows. Renaming or removing one is not: it needs a
new type and a column rewrite. That asymmetry is the price of the database enforcing the values,
and it is worth paying for a set of three that describes a workflow.

**The type and the Java enum are declared twice, so a test holds them together.**
`TaskEnumColumnTest` asserts that both columns really are enum types and that the type's labels
match the Java constants exactly, in order. Drift fails the build rather than the first request
that uses the new value — checked by adding a constant on one side and watching it fail, not
assumed.

**Rejected: a `CHECK` constraint.** It would have enforced the values with none of the
asymmetry above, and `ALTER TABLE ... DROP CONSTRAINT` would make changes easier. It was
rejected because a check constraint states the values in a condition rather than as a type:
nothing else can refer to it, `information_schema` does not describe it as a domain of values,
and every table wanting the same set repeats the condition. The enum is the thing PostgreSQL
has for this.

**Rejected: leaving it as `VARCHAR` and relying on the application.** That is what was there,
and the argument for it — only this application writes — is an argument that holds until it
does not.

## The schema carries the constraints, and every string has a bound

**Decision.** Jakarta Bean Validation annotations on the response records, not only on the
requests, with these bounds:

| Field | Max | Why that number |
| --- | --- | --- |
| `description` | 255 | The column width; the two must agree or a valid value is a 500 |
| `email` | 254 | RFC 5321: a 64-character local part, an at sign, a domain of up to 255 |
| display name | 255 | Not stored, so only the schema bounds it |
| any URL | 2048 | The practical ceiling browsers have long enforced |
| provider id | 64 | Our own configuration key, and short |
| provider label | 100 | A word or two on a button |

**Why bound them at all.** The frontend compiles these schemas into the validators it checks
every response with, so a bound written here is enforced in the browser. Before this, every
string on the wire was unbounded: `description` could exceed the column that stores it, and
nothing said an email was an email.

**Why standards-based rather than tighter.** A bound that rejects a legitimate value is worse
than one that is loose. A provider's picture URL carries size and crop parameters and is
routinely a few hundred characters; 2048 bounds it without guessing at a provider's habits.

**`@NotNull` replaced the hand-written required lists,** except where required and non-null
differ. `AuthProviderResponse.loginUrl` is required *and* null for an unusable provider, and
`available` is a primitive, so that record still lists its required properties on the type.

**Rejected: `Optional<T>` for the optional fields**, which issue #70 asked for. Measured rather
than assumed: a single `Optional` component costs the *operation* its schema reference. The
component schema survives, but `/api/auth/me` stops declaring what it returns, so Redoc and any
generator lose the link. `Optional` is used in service signatures instead, where it helps and
touches no schema.

**`@Email` turned out to be runtime-only.** SmallRye emits nothing in the schema for it, so the
document says what the string is through `@Schema(format = "email")`. The frontend registers
`email` as a regular expression, deliberately as loose as the backend's own constraint: a
stricter pattern would reject an address the backend had already accepted and stored.

**A side effect worth recording: no operation had declared its response schema.** Every
`@APIResponse` that specified `@Content` for its examples had suppressed the schema SmallRye
would otherwise have derived, so the document described five endpoints that returned something
unspecified. `OpenApiContractTest` now asserts the reference exists.

**The one cost.** `maxLength` makes Ajv's compiled validators call into `ajv/dist/runtime`,
which the generator previously refused outright. The check now allows Ajv's own helpers, which
Vite bundles at build time, and still refuses any other package: adding `format` through
`ajv-formats` would land there, which is why `date` and `email` are regular expressions. `ajv`
remains a devDependency and `dependencies` is still React alone. The bundle grew by 2.5 kB.

## Wire identifiers are constants, and a GET's query count is asserted

**Decision.** The OpenID Connect claim names this application reads live in `OidcClaims`, and
`TaskQueryCountTest` holds the list endpoint to a constant number of database statements.

**Why the claim names.** They were literals at each call site: `jwt.getClaim("email")`,
`jwt.getClaim("picture")`. A claim name is a wire identifier, and misspelling one compiles,
passes a test that stubs the token with the same misspelling, and surfaces only as an empty
field in the browser.

**What the standard library actually covers, since the issue asked.** MicroProfile JWT's
`Claims` enum names each claim by its own `name()`, so `Claims.email.name()` is `"email"` and
is used. It has **no `picture`**. It does have `full_name`, which is *not* OpenID Connect's
`name` claim — the constant is called `full_name` and so is the claim it stands for. So one of
the three is covered by the standard and two are declared here, with that written down so the
search is not repeated.

**Why the query count is a test rather than a rule.** The rule is that a GET runs a constant
number of statements — one ideally, two or three acceptable — and never a number that grows
with the rows returned. Nothing else notices when that breaks: the responses stay correct, the
tests stay green, and only the statement count moves. The change that causes it is usually
somewhere else entirely, so the count is what has to be asserted.

**The test's limits, stated rather than overread.** `Task.owner` cannot produce an N+1 however
it is fetched, because every task in one response belongs to the same user and that user is
already in the persistence context from resolving the caller — touching it per row costs
nothing. The test was validated against genuine per-row work instead, which took the count from
three to twelve and failed both assertions. Its value is in guarding what comes later: a
collection on `Task`, an association added to a response.

**Rejected: extracting every repeated literal.** The component names inside
`@Schema(requiredProperties = ...)` are repeated, and turning them into constants would make
them harder to read while protecting nothing a rename would not also break. The better answer
was removing most of those lists, which `@NotNull` on the components already did.

**Rejected: enabling Hibernate statistics everywhere.** Collecting them costs something and the
production application has no use for the numbers, so
`%test.quarkus.hibernate-orm.statistics=true` is test-only.

## Spacing and type are scales, not values

**Decision.** `App.css` defines a strict 4px spacing grid and exactly four type sizes, and every
padding, margin, gap and font size in the stylesheet comes from them.

| | |
| --- | --- |
| Spacing | `--space-1` … `--space-16`, the number being the step count, so `--space-4` is 16px |
| Type | `--font-display` 2rem, `--font-title` 1.5rem, `--font-body` 1rem, `--font-small` 0.875rem |

**Why.** Colour was already tokenised and dark-mode aware; spacing and type were not. There
were **16 distinct pixel values** across padding, margin and gap and **ten** font sizes, mixing
`rem` with a stray `16px`. Most of the spacing was already a 4px multiple, which is what made
the outliers worth removing rather than accommodating: `7px`, `10px`, `14px`, `6px` were drift,
not intent.

**What actually moved.** Sixteen declarations changed value; the rest only changed to a token.
The largest were `.app-footer` 40 → 32, `.button-primary` 20 → 24, `.task-section` and
`.completed-section` 28 → 24, and the type collapse: `1.25rem` and `1.1rem` to body,
`0.8125rem`, `0.75rem` and `0.6875rem` to small. Verified by rebuilding the design-system bundle
and comparing the rendered cards before and after — the risk was `.user-avatar--initials` going
11px → 14px inside a 28px circle, and it fits.

**Four declarations are deliberately off the scale**, each with a comment saying so:
`:root`'s `font-size: 16px`, which defines what `1rem` means rather than being an entry in the
scale; `.visually-hidden`'s `margin: -1px`, part of the standard clip idiom; and the `2px` top
margins on `.task-check` and `.task-meta`, which are optical nudges that a scale step in either
direction visibly misaligns.

**Rejected: keeping every existing value and naming it.** A scale with `--space-7px` in it is a
list, not a scale, and gives the design agent no reason to prefer one value over another. The
point of a strict grid is that the next person has eight choices rather than sixteen.

**Rejected: a separate spacing token per component.** Tokens named for where they are used
(`--task-row-gap`) grow with the component count and stop composing; a step scale is reusable by
anything, including the layout the design agent writes around these components.

**The agent is told.** `.design-sync/conventions.md` carries both scales, and
`npm run check:conventions` already validates every name it lists, so the new tokens are covered
by the existing guard without changing it.

## The deployment shape

The plan is `deployment.md`; these are the choices in it that had a real alternative. Nothing is
built yet — #60 produced the plan deliberately, because several of these are hard to reverse once
anything exists.

**One AWS account, with IAM roles and resource tags.** This reverses an earlier decision to use
separate accounts. The hosted zone and the certificates live in the existing account, and
splitting turned every DNS record and every ACM validation into a cross-account operation — for
two hostnames.

**What it costs is stated rather than glossed.** With separate accounts, "prod is never created
by an automated agent" was enforceable because the prod account held nothing to assume. In one
account it is a policy: three technical IAM users, one per job, scoped by resource tag — a QA
deployer denied everything tagged `env=prod`, a prod deployer whose key lives in a GitHub
environment that requires human approval, and a read-only user for monitoring. The hole that remains is local credentials — an agent
running with an administrator profile could reach prod, and only a least-privilege local profile
stops it. That is a discipline, not a wall. The wall was the account boundary, and it was traded
for not having to cross an account boundary to write two DNS records.

A second consequence: with no per-account bill, cost attribution moves to tags, and an untagged
resource becomes invisible to both environment budgets.

**PostgreSQL on RDS, destroyed with a final snapshot when idle.** The database is managed because
this stands in for a commercial project and a managed database is part of what it proves.
*Rejected: stopping the instance.* It still bills storage, and **AWS restarts a stopped instance
after seven days**, so it does not survive a demo that is idle for weeks. *Rejected: Aurora
Serverless v2 with scale-to-zero*, which pauses properly and resumes in about fifteen seconds —
but it is Aurora rather than plain RDS, and the commercial project this represents would use
plain RDS. *Rejected: PostgreSQL as a container*, the original plan, for the same reason RDS was
chosen.

**The application authenticates to RDS with IAM, not a password.** The task role is the
credential: a token signed per connection by a Quarkus `CredentialsProvider`, which Agroal asks
again for every connection it opens — `DatasourceCredentialsPerConnectionTest` holds it to that,
because a token fetched once would fail 15 minutes after the first connection was replaced.
*Rejected: injecting the database password from Secrets Manager* through the task definition.
RDS rotates a managed secret every seven days and ECS reads it only at task start, so a running
task would keep the old one; it would also have meant the application using the master user.
*Rejected: the AWS Advanced JDBC Wrapper*, which does the same signing inside a replacement
driver. It would have needed `db-kind=other`, an explicit Hibernate dialect, and Dev Services
replaced, where the credentials provider leaves the PostgreSQL driver and every test untouched.
*Decided: one database user per environment*, `todolist_<env>`, for both the application and
the migrations, and the IAM grant names that user rather than the instance — an instance's
resource id changes with every restore, while the user travels with the snapshot.

**The frontend is static on S3 behind CloudFront, with `/api/*` on the same distribution.** No
container, no task, no image to patch — which is also part of the answer to #66. The second
origin is not optional: httpd currently serves the SPA *and* proxies the API, and that
same-origin arrangement is what the OIDC `redirect_uri` and the session cookie depend on.
Serving only S3 would break sign-in after deployment, where nothing local would catch it.
*Rejected: the frontend container on ECS*, which keeps local and production identical at the cost
of a load balancer target, a task and a base image that needs patching forever.

**GitHub Actions, not CodePipeline.** One pipeline rather than two, and the prod gate is a
protected environment. It runs as a **technical IAM user per environment** rather than assuming a
role through OIDC, which is what was asked for. The cost is **long-lived access keys** held as
GitHub secrets, where OIDC would have issued short-lived credentials and stored nothing; least
privilege by tag, rotation, and an alarm on use from outside Actions are the mitigations, and
moving to OIDC later changes nothing else in the plan. Cost did not decide the CodePipeline
question — a V1 pipeline is
about a dollar a month and CodeDeploy is free for ECS. *Rejected: CodePipeline*, which would be
right if demonstrating AWS-native CI/CD were itself the point, or if blue/green still required
CodeDeploy. It no longer does: ECS has blue/green natively, which removed the main argument.

**Two deployment paths rather than expand-and-contract.** A release with no migration goes
blue/green with zero downtime and an instant rollback; a release with a migration takes the
downtime, because nothing old running means nothing needs to be backward-compatible. The image
carries the schema it expects and the deployment picks the path. *Rejected: expand-and-contract
everywhere*, the usual answer, which buys zero-downtime schema changes at the cost of every
change shipping in two releases — not worth it when downtime is acceptable. *Rejected:
`migrate-at-start` in production*, which on ECS would migrate from a new task while an old one
still served.

**The load balancer stays, and is internal.** It is the largest fixed cost in an environment
(~$16 a month, idle or not), so it was challenged. It stays because **ECS blue/green shifts
traffic between two target groups**, which is a load balancer's job — there is no
load-balancer-free form of it, and demonstrating blue/green is one of the reasons this
deployment exists. *Rejected: a Network Load Balancer*, the same price per hour, and worse here —
ECS adds a ten-minute delay to the blue/green lifecycle stages with an NLB and supports only
all-at-once shifting. *Rejected: CloudFront straight to the ECS service*, which VPC origins do
not support and which a changing task IP would break anyway. *Rejected: an API Gateway HTTP API
with a VPC link* — which is cheaper, but by less than it appears. **A VPC link is $0.01/hour,
about $7.20 a month, charged at zero traffic**, so the comparison is $16 against $7.20 and the
saving is about nine dollars an environment, not sixteen. That nine dollars buys the blue/green
demonstration, and it only applies while an environment is up — which, by design, QA usually is
not. The real lever is destroying idle environments, and it destroys the load balancer too.

*Rejected: one load balancer shared by both environments* with host-based rules. It would halve
the cost only while both are up, which is the uncommon case, and it cannot be destroyed with
either environment — so it needs a third OpenTofu stack and couples the two together.

It is **internal**, reached through a CloudFront VPC origin, so it has no public address.
*Rejected: a public load balancer with a shared secret header* that CloudFront sends and the
load balancer checks — the older pattern, which works but leaves a bypass that depends on a
secret staying secret. VPC origins remove the public address instead, at no cost.

**Custom hostnames under an existing zone.** `todolist-qa.cloud.hilling.de` and
`todolist.cloud.hilling.de`, as alias records to each environment's distribution. This is what
makes the Google OIDC redirect URIs knowable before the environments exist, which matters
because that configuration is manual and cannot be automated here. One consequence is worth
recording rather than rediscovering: **the ACM certificate must live in `us-east-1`**, whatever
region the environment uses, because CloudFront accepts certificates from nowhere else.

They are **alias records, not `CNAME`s**. Route 53 does not charge for queries to an alias record
pointing at an AWS resource, while a `CNAME` is $0.40 per million — and a `CNAME` to another name
in the same zone is billed as two queries, because the resolver asks twice. The amounts are
trivial at demo traffic; the point is that the alias is free, needs one lookup instead of two,
and is the only one of the two that works at a zone apex. *Rejected: CloudFront's own domain*,
which would have worked and would have left the sign-in configuration undoable until after the
first deployment.

**Fargate tasks in public subnets, with no NAT gateway.** A NAT gateway is about $33 a month
before data — more than the database, and the largest line item in an environment that would
otherwise cost about $50. The tasks take a public IP and are reachable from nothing: the security
group admits only the load balancer. *Rejected: private subnets with a NAT gateway*, which is
what a commercial deployment should do and what the plan says to do when this stops being a demo.
*Rejected: VPC endpoints instead of NAT*, which is cheaper than NAT but still per-endpoint, and
more moving parts than a demo justifies. Without endpoints there is also no *request-side* VPC restriction:
`aws:SourceVpc` is only set on a request that goes through one, and `aws:Ec2InstanceSourceVpc`
covers EC2 instance credentials, not Fargate task roles. What is restricted by VPC instead is where
the deploy and lifecycle roles may *place* the service and the load balancer — see
`deployment.md`.


**Misconfiguration scanning is static, in CI, with Trivy — not AWS Config.** Most of what a
best-practice rule set checks — public buckets, open ingress, unencrypted storage, wildcard IAM —
is readable from the `.tf` files, so Trivy fails the pull request before the change exists. It
fails at every severity, and an exception is a `#trivy:ignore:<ID>` comment beside the resource
with the reason, so the list of exceptions is the code rather than a dashboard. *Rejected for now:
AWS Config*, which adds what a static scan cannot see — changes made outside OpenTofu, and the
history of a resource's configuration — at about $2–5 a month for recording and a handful of
managed rules, and $10–20 with a full conformance pack, because this project's up/down cycles
and deploys churn configuration items. With one human applying infrastructure that is a small
risk for a fixed cost; it is worth revisiting when this stops being a demo. *Not chosen: Checkov*,
which would have done the same job equally well; Trivy is simply the one chosen.

**VPC flow logs go to S3, all traffic, for 30 days.** Delivery to S3 is about half the per-GB
price of CloudWatch Logs and needs no delivery role, and logs read when something needs
explaining do not need CloudWatch's query console. All traffic rather than rejected-only, because
the useful question is what talked to what. The bucket is encrypted with S3-managed keys:
*rejected: a customer-managed KMS key*, which at about $1 a month costs more than the logs.
