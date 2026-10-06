# Build, release and dependencies

## Jib with a pinned Java 25 base image

**Decision.** The backend image is built by Jib onto a pinned Java 25 base image — since #66 our
own `jre-runtime`, Temurin's JRE on UBI micro
([containers-and-local-stack.md](containers-and-local-stack.md#the-backend-runs-on-our-own-jre-runtime-temurins-jre-on-ubi-micro)),
before that `eclipse-temurin:25.0.4.1_1-jre-ubi10-minimal`, which the history below is about. All four Dockerfiles Quarkus generated under
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
dependency versions rather than container references. Since the move to `jre-runtime` (#66) the
manager captures the tag *and* the digest, and orders the `<temurin>-<date>` tags with a regex
versioning that ignores the undated moving tags; it was checked against the real file — it
resolves `quay.io/ghilling/jre-runtime`, the tag and the digest, with the `docker` datasource.


## sun_checks with documented relaxations

**Decision.** Checkstyle's `sun_checks.xml` as the style baseline, with a short list of
relaxations recorded in the header of `backend/checkstyle.xml`, and type-level Javadoc
required via `MissingJavadocType`.

**Why.** A standard ruleset beats a bespoke one, and the relaxations that remain each have
a stated reason rather than being silently dropped. Per-member Javadoc stays optional
because it fights JAX-RS and CDI code; type-level Javadoc is required because "what is this
type for?" is the question that code cannot answer for itself.


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


## Misconfiguration scanning is static, in CI, with Trivy — not AWS Config

Most of what a
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

## SonarCloud runs on `main` only, and a failed quality gate becomes an issue

On pull requests it
re-ran the entire backend suite for its coverage report, and with no path filter it was the check
every pull request waited for — including the infrastructure and documentation changes that make
up most of them. It now runs after the merge. Until then it also never failed on findings: the scan
uploaded an analysis without waiting for the quality gate. It now waits
(`sonar.qualitygate.wait`), and `sonar-gate-issue.py` turns a failure into **one** open issue,
labelled `sonarcloud-gate`: commented on while the gate stays red, closed when it is green again.
*Rejected: keeping it on pull requests without waiting for it*, because Renovate merges only when
every check is green and cannot leave one out. *Not done: reusing backend CI's coverage report
instead of re-running the tests*, which would need artifacts handed between workflows for a
saving that no longer blocks anything. The cost is that a finding is seen after the merge, not
before — accepted, because it then becomes an issue like any other piece of work.
