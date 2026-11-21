# Releasing

From GitHub: **Actions → Cut a release → Run workflow**, on `main`, which picks the version
([below](#cutting-a-release-from-github)). Or by hand, with a version of your choosing:

```bash
git tag -a v1.0.0 -m "TaskFest v1.0.0"
git push origin v1.0.0
```

That is the whole procedure either way: a tag. Everything else is `.github/workflows/release.yml`.

The tag is **annotated** (#333): a tag object that says who tagged and when, and in its message
why — `cut-release.yml` writes the reason for the version's step there; by hand, say what the
release is for. It is not a bare name for a commit: `release.yml` refuses a lightweight one —
`git tag v1.0.0` without `-a` — so nothing is released from it. Delete it, on `origin` too, and
tag again with `-a`: the two lines under [If a release fails](#if-a-release-fails).

## The version lives in the tag and nowhere else

There is no version to bump before a release and none to bump after one. The release build
hands the tag's version to what it builds: to the Go backend's functions as `TASKFEST_VERSION`
(`serverless/build.sh`), which `GET /api/version` reports and which is `1.0.0-SNAPSHOT` for any
other build, to the frontend build as `VITE_TASKFEST_VERSION`, and to the API contract through
`doc/api/generate.py --version`. The frontend's `package.json` says `0.0.0` and always will: the
package is `private` and never published to npm, so nothing reads that field. Until #559 the
Quarkus backend's `pom.xml` carried `${revision}`, overridden from the tag the same way.

Tags are `vMAJOR.MINOR.PATCH`, optionally with a suffix of dot-separated parts of letters and
digits (`v1.1.0-rc.1`). The workflow's trigger matches those two shapes only, so an unrelated tag does not
start a release, and its `gate` refuses any other suffix (#433), as the deploy workflows do. A tag
with a suffix becomes a GitHub pre-release, never the repository's latest release.

## Which number to raise

Installed mobile apps lag behind the backend by weeks, so a release's number says what an app can
rely on (#268, [decisions/mobile-app.md](decisions/mobile-app.md)). From **1.0.0**, the first
release apps are built against, the API decides (the app builds follow during 1.x):

| Change | Release |
| --- | --- |
| An app built for an earlier release can no longer use the API: an endpoint or a field gone, a request field newly required, a response's type changed | **major** |
| A compatible addition: a new endpoint, an optional request field, a new response field | **minor** |
| Neither | **patch** |

Under 0.x semantic versioning promises nothing; the releases before 1.0.0 made no such promise.

**Enforced, not remembered.** Contract CI compares `doc/api/openapi.yaml` with the one of the
release named in `doc/api/oldest-supported-release`, using
[oasdiff](https://github.com/oasdiff/oasdiff), and fails on a breaking change. A breaking change
therefore cannot land by accident; landing one on purpose takes three things in the same pull
request:

1. move `doc/api/oldest-supported-release` forward to the oldest release the backend will still
   serve after the change;
2. raise the minimum app version, `minimumAppVersion` in `serverless/internal/api/version.go`
   (`TASKFEST_MINIMUM_APP_VERSION` overrides it), to the first app release that copes with it —
   `/api/version` announces it, and older apps ask their user to update;
3. tag the next release as the next **major**.

Before that, consider not breaking anything: a new endpoint or a new field beside the old one is
a minor release, and the old one can go in a later major once no supported app uses it. Which
releases still call what is in the request log, whose `app` field is the version the app names
in `X-TaskFest-App`.

**Raising the minimum without a break.** An app can be too old for a compatible API, too: one
before 1.4.0 saves a task without the due time it does not know (#475). Then only step 2 applies:
`oldest-supported-release` stays, and the release is a **minor**, asked for with `bump: minor`
when `auto` would give a patch.

**New enum values** in a response are a warning, not an error: oasdiff cannot tell whether
clients tolerate them. The app reads a value it does not know as unknown rather than refusing the
response, so for the app they are compatible; the website, which always deploys with its backend,
stays strict.

**A removed security requirement** is a warning too, not oasdiff's error: `doc/api/oasdiff-levels`
says so for Contract CI and `cut-release.yml` alike (#632). The backend authenticates in code, and
nothing generated from the contract reads its `security`, so removing one breaks no client.

**Several API versions at once**, should a breaking change ever be unavoidable: today's paths are
version 1. A breaking change would add `/api/v2/...` beside them, from records of its own, with its
own OpenAPI document and its own baseline, and v1 would stay served until
the minimum app version no longer admits an app that uses it. Path versioning keeps the
CloudFront routing and the generated documents simple. None exists yet.

## Cutting a release from GitHub

`.github/workflows/cut-release.yml` takes the newest release — the highest `vX.Y.Z` tag, pre-releases
aside — compares its `doc/api/openapi.yaml` with `main`'s using the oasdiff Contract CI gates with,
and raises the version as the table above says: an error is a **major**, any other change, a
warning included, a **minor**, none a **patch**. `.github/scripts/release-version.py` decides, and
its tests pin the rule down.

| Input | Meaning |
| --- | --- |
| `bump` | `auto` (the default) lets the API decide. `patch`, `minor` or `major` ask for a step: a larger one than the API needs is taken, a smaller one refused |
| `dry-run` | Decide and report only; nothing is tagged |

The run's summary says the version, the step and oasdiff's reasons, in a dry run too. **A major for
a break of the API is refused** until the two changes it needs have been made since the newest
release: `doc/api/oldest-supported-release` moved forward and `minimumAppVersion` raised
(their values, not the comments around them). Contract CI cannot insist on them alone: it compares
with the oldest supported release only, so removing something added after that one passes it. A
major asked for without a break needs neither. A real run then tags `main` and starts
`release.yml` for the tag. It has to start it explicitly: a tag pushed with a workflow's own token
starts no workflow, GitHub's guard against runs starting runs. `release.yml` therefore also has a
`workflow_dispatch` trigger, and refuses to run for anything but a tag `vX.Y.Z`. Its `announce`
job creates the GitHub Release with the generated notes, as for a tag pushed by hand, so no
Release exists before its artifacts do.

**Under 0.x** `auto` gives a minor, whatever the API did; a patch may be asked for. **1.0.0 is not cut here**: it is released by hand, together, and a `major` asked for
under 0.x is refused. From then on, the API decides.

The workflow refuses to run on any branch but `main`, and when `main` is already a final release;
a pre-release (`-rc.1`, tagged by hand) on the same commit does not count. `release.yml` in turn
refuses a tag that already has a GitHub Release, so starting it again by hand cannot build a
released version's artifacts again; when GitHub cannot say, it refuses as well.

## What the workflow does

| Job | What it does |
| --- | --- |
| `gate` | Derives the version, refuses a lightweight tag and one that is not on `main`, writes the API contract at the release version, refuses a pre-release npm dependency, runs the full frontend suite, and packs the frontend build — built with `VITE_TASKFEST_VERSION` from the tag, which the page's footer shows (a build that is no release says *Development build*) |
| `serverless` | Builds the Go backend's five functions once, with the version from the tag, which `GET /api/version` reports (#555), as `taskfest-serverless-<version>-<function>.zip` |
| `announce` | Creates the GitHub Release — a pre-release, not the latest, for a tag with a suffix — with notes generated from the pull requests since the previous final release, so a final release's notes cover its pre-releases too, and attaches the API contract, `taskfest-frontend-<version>.tar.gz` — the build `deploy-frontend.yml` puts into a site bucket — and the Go backend's five zips, which `deploy-serverless.yml` deploys |
| `mobile` | Once the release exists, builds the app's qa and prod variants for a final release, signed, and uploads them to TestFlight and Play internal testing through `mobile-release.yml`, once Gunnar approves the `app-stores` deployment in the run — see [Distribution to testers](mobile/distribution.md). A platform whose accounts are not set up yet is skipped |
| `deploy-serverless-qa`, `deploy-frontend-qa` | Deploy a final release — not a pre-release — to qa, the Go backend first, through `deploy-serverless.yml` and `deploy-frontend.yml` — see [Deploying](deployment/deploying.md) and [the Go backend's deploy](deployment/serverless.md#deploying-a-release). The functions are always there, so they are deployed whether qa is up or not, and the frontend follows once they are. prod is always deployed by hand |

Until #559 a release also published the Quarkus backend's and the frontend's images to Quay and
deployed the backend's to qa's containers, `taskfest-backend:<version>`; the frontend image is
built for the end-to-end stack only now. Those released images stay on Quay.

**Releases up to v0.2.0 carry the old name.** Their images are `quay.io/ghilling/todo-backend`
and `todo-frontend`, and their frontend archive is `todo-frontend-<version>.tar.gz`; everything
after the rename to TaskFest (#128) is `taskfest-*`. The old Quay repositories stay as they are,
and `deploy-frontend.yml` accepts either archive name, so an old release can still be deployed
for a rollback.

`gate` runs the frontend's checks again rather than trusting the CI run on `main`. That is
deliberate: `frontend-ci.yml` is path-filtered, so for any given commit on `main` it may not have
run at all. The Go backend's functions are built by the `serverless` job, from the tag.

## The no-pre-release check

npm has no equivalent of Maven's SNAPSHOT, so the analogous mistake is a semver pre-release:
`-beta.2`, `-rc.1`, `-canary.a1b2c3`, which is what installing a `next` or `canary` dist-tag gives
you. `frontend/scripts/check-no-prerelease-deps.mjs` reads `package-lock.json` — not
`package.json`, because a caret range says nothing about what a transitive dependency actually
resolved to — and fails naming each offender. Run it locally with `npm run check:deps`. `gate`
runs it for the frontend, and Mobile CI for the app on every pull request. The Quarkus backend's
counterpart, `maven-enforcer-plugin`'s `requireReleaseDeps` on every build, went with it (#559).

## What a release publishes

Every release carries the API contract as downloadable assets: `openapi.yaml`,
`openapi.json`, and one `<Name>.schema.json` per type. They are attached individually rather
than as an archive so each has a citable URL, and the relative `$ref`s between the schemas
still resolve because they name siblings.

These are **written again during `gate`**, not taken from the commit. The committed
`doc/api/openapi.json` says `1.0.0-SNAPSHOT`, because that is what `main`'s version permanently
is; `generate.py --version` writes the tag's version into the documents, which is what makes the
attached spec claim the version it describes.

The same contract is also on GitHub Pages, at
[taskfest-docs.cloud.hilling.de](https://taskfest-docs.cloud.hilling.de/):
`/api/v1.2.3/` per release, `/api/latest/` for the newest final release, never a pre-release (#433), and `/api/main/` tracking the
current code. `pages.yml` rebuilds the whole site from git history, so nothing is carried over
between deployments. It patches `info.version` from the tag for a released version; the release
assets need no such patch, which is why those are the authoritative download.

`announce` asks for that rebuild with `gh workflow run pages.yml --ref main` once the release
exists — **on `main`, not on the tag.** The `github-pages` environment permits deployments from
the branch `main` alone, so a rebuild triggered by the release event, whose ref is
`refs/tags/v1.2.3`, would be refused before its first step. By then the tag is in history, so
the build sees the new version anyway.

`republish-site`, the release's last job, asks for it once more after the live tests on qa, so
the site's videos page shows the release's own run. `pages.yml` rebuilds after a completed
`Release` run by itself as well, but not after one `cut-release.yml` started: that run is
started with a workflow's token, and its end sets off no other workflow.

## If a release fails

Nothing is published until `gate` is green, and the GitHub Release is not created until the Go
backend's functions are built, so a failure part-way leaves no half-release. Fix the cause on
`main` through a pull request, then delete and re-push the tag:

```bash
git tag -d v1.0.0 && git push origin :refs/tags/v1.0.0
git tag -a v1.0.0 -m "TaskFest v1.0.0" <new-sha> && git push origin v1.0.0
```

Re-pushing a tag that already has a GitHub Release will not overwrite the release; delete
that first if it exists.
