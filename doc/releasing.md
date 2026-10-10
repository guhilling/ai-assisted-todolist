# Releasing

```bash
git tag v1.0.0
git push origin v1.0.0
```

That is the whole procedure. Everything else is `.github/workflows/release.yml`.

## The version lives in the tag and nowhere else

There is no version to bump before a release and none to bump after one. `backend/pom.xml`
declares `<version>${revision}</version>` with the property defaulting to `1.0.0-SNAPSHOT`,
and the release build overrides it with `-Drevision=1.0.0` taken from the tag name. The
frontend's `package.json` says `0.0.0` and always will: the package is `private` and never
published to npm, so nothing reads that field. The image tag carries the version instead.

This is Maven's "CI-friendly version" mechanism. The usual caveat with it — that an
installed or deployed `pom.xml` keeps the literal `${revision}` unless
`flatten-maven-plugin` rewrites it — does not apply here, because no Maven artifact is
published. Nothing outside this repository ever consumes the backend's POM. If that changes,
`flatten-maven-plugin` becomes necessary.

Tags are `vMAJOR.MINOR.PATCH`, optionally with a suffix (`v1.1.0-rc.1`). The workflow's
trigger matches those two shapes only, so an unrelated tag does not start a release.

## Which number to raise

Installed mobile apps lag behind the backend by weeks, so a release's number says what an app can
rely on (#268, [decisions/mobile-app.md](decisions/mobile-app.md)). From **1.0.0**, the first
release with an app build, the API decides:

| Change | Release |
| --- | --- |
| An app built for an earlier release can no longer use the API: an endpoint or a field gone, a request field newly required, a response's type changed | **major** |
| A compatible addition: a new endpoint, an optional request field, a new response field | **minor** |
| Neither | **patch** |

Under 0.x semantic versioning promises nothing; the releases before 1.0.0 made no such promise.

**Enforced, not remembered.** Backend CI compares `doc/api/openapi.yaml` with the one of the
release named in `doc/api/oldest-supported-release`, using
[oasdiff](https://github.com/oasdiff/oasdiff), and fails on a breaking change. A breaking change
therefore cannot land by accident; landing one on purpose takes three things in the same pull
request:

1. move `doc/api/oldest-supported-release` forward to the oldest release the backend will still
   serve after the change;
2. raise `taskfest.minimum-app-version` (`TASKFEST_MINIMUM_APP_VERSION`) to the first app release
   that copes with it — `/api/version` announces it, and older apps ask their user to update;
3. tag the next release as the next **major**.

Before that, consider not breaking anything: a new endpoint or a new field beside the old one is
a minor release, and the old one can go in a later major once no supported app uses it. Which
releases still call what is in the request log, whose `app` field is the version the app names
in `X-TaskFest-App`.

**New enum values** in a response are a warning, not an error: oasdiff cannot tell whether
clients tolerate them. The app reads a value it does not know as unknown rather than refusing the
response, so for the app they are compatible; the website, which always deploys with its backend,
stays strict.

**Several API versions at once**, should a breaking change ever be unavoidable: today's paths are
version 1. A breaking change would add `/api/v2/...` beside them, from records of its own, with its
own OpenAPI document and its own baseline, and v1 would stay served until
`taskfest.minimum-app-version` no longer admits an app that uses it. Path versioning keeps the
CloudFront routing and the generated documents simple. None exists yet.

## What the workflow does

| Job | What it does |
| --- | --- |
| `gate` | Derives the version, refuses a tag that is not on `main`, then runs the full backend `verify` and the full frontend suite at the release version, and packs the frontend build — built with `VITE_TASKFEST_VERSION` from the tag, which the page's footer shows (a build that is no release says *Development build*) |
| `publish` | Builds and pushes `taskfest-backend` and `taskfest-frontend` to Quay, tagged with the version, each for `amd64` and `arm64` in one image index, and checks both are there (#249) |
| `announce` | Creates the GitHub Release, with notes generated from the pull requests since the previous release, and attaches the API contract and `taskfest-frontend-<version>.tar.gz` — the build `deploy-frontend.yml` puts into a site bucket |
| `deploy-backend-qa`, `deploy-frontend-qa` | Deploy a final release — not a pre-release — to qa, backend first, through `deploy-backend.yml` and `deploy-frontend.yml` — see [Deploying](deployment/deploying.md). A qa that is down is skipped without failing the release; a release that changes the database changelog takes the downtime path described below, and its frontend follows once the backend serves. prod is always deployed by hand |

**A release with a migration** reaches qa by itself, with a few minutes' downtime:
`deploy-backend-qa` stops the backend, snapshots the database, migrates and starts the release
(#215, [Deploying](deployment/deploying.md)), and `deploy-frontend-qa` follows as for any other
release. For prod, the same two workflows are started by hand, and the backend's approval names
the job `Deploy to prod WITH DOWNTIME (database migration)`. If the migration fails, the backend
stays stopped, the frontend is not deployed, and the run summary names the snapshot to restore
([The database](deployment/database.md)).

**Releases up to v0.2.0 carry the old name.** Their images are `quay.io/ghilling/todo-backend`
and `todo-frontend`, and their frontend archive is `todo-frontend-<version>.tar.gz`; everything
after the rename to TaskFest (#128) is `taskfest-*`. The old Quay repositories stay as they are,
and `deploy-frontend.yml` accepts either archive name, so an old release can still be deployed
for a rollback.

`gate` runs everything again rather than trusting the CI run on `main`. That is deliberate:
`backend-ci.yml` and `frontend-ci.yml` are path-filtered, so for any given commit on `main`
one of them may not have run at all, and the release checks below only exist in the release
profile.

## The no-snapshot checks

This is the part worth understanding, because there are two different mechanisms and only
one of them is release-specific.

**Backend, every build.** `maven-enforcer-plugin` runs `requireReleaseDeps` at `validate` on
every single build, not only releases. A SNAPSHOT dependency is a mistake whenever it is
introduced, so it fails immediately rather than being discovered at the worst moment. It
names the offending coordinate:

```
Rule 0: RequireReleaseDeps failed with message:
A release cannot depend on a SNAPSHOT. Replace the
   org.example:deliberate-snapshot:jar:1.0-SNAPSHOT <--- is not a release dependency
```

**Backend, releases only.** `-Prelease` adds `requireReleaseVersion`, which fails if the
artifact being built is itself a SNAPSHOT. On `main` it always would be, which is why it is
in a profile rather than always on. In practice it catches a release workflow that somehow
failed to pass `-Drevision`.

**Frontend.** npm has no equivalent of a SNAPSHOT, so the analogous mistake is a semver
pre-release: `-beta.2`, `-rc.1`, `-canary.a1b2c3`, which is what installing a `next` or
`canary` dist-tag gives you. `frontend/scripts/check-no-prerelease-deps.mjs` reads
`package-lock.json` — not `package.json`, because a caret range says nothing about what a
transitive dependency actually resolved to — and fails naming each offender. Run it locally
with `npm run check:deps`.

## What a release publishes besides the images

Every release carries the API contract as downloadable assets: `openapi.yaml`,
`openapi.json`, and one `<Name>.schema.json` per type. They are attached individually rather
than as an archive so each has a citable URL, and the relative `$ref`s between the schemas
still resolve because they name siblings.

These are **regenerated during `gate`**, not taken from the commit. The committed
`doc/api/openapi.yaml` says `1.0.0-SNAPSHOT`, because that is what `main`'s revision
permanently is; `gate` builds with the revision overridden from the tag, so regenerating
afterwards is what makes the attached spec claim the version it describes.

The same contract is also on GitHub Pages, at
[guhilling.github.io/ai-assisted-todolist](https://guhilling.github.io/ai-assisted-todolist/):
`/api/v1.2.3/` per release, `/api/latest/` for the newest, and `/api/main/` tracking the
current code. `pages.yml` rebuilds the whole site from git history, so nothing is carried over
between deployments. It patches `info.version` from the tag for a released version; the release
assets need no such patch, which is why those are the authoritative download.

`announce` asks for that rebuild with `gh workflow run pages.yml --ref main` once the release
exists — **on `main`, not on the tag.** The `github-pages` environment permits deployments from
the branch `main` alone, so a rebuild triggered by the release event, whose ref is
`refs/tags/v1.2.3`, would be refused before its first step. By then the tag is in history, so
the build sees the new version anyway.

## `latest` is not moved by a release

`publish-images.yml` pushes `latest` on every merge to `main`, and a release does not
change that. So `latest` means the tip of `main`, and `1.0.0` means the release. The Compose
stacks default to `latest`, which is what you want locally.

This is worth knowing because it is the opposite of the usual container convention, where
`latest` tracks the newest release. It is the pre-existing behaviour of this repository and
a release was not allowed to start fighting `main` over the same tag. If the deployment
story later wants `latest` to mean the newest release, the change belongs in
`publish-images.yml` — stop it pushing `latest` — and in `release.yml` at the same time, not
in one of them alone.

## If a release fails

Nothing is published until `gate` is green, and the GitHub Release is not created until both
images are pushed, so a failure part-way leaves no half-release except possibly one of the
two images. Fix the cause on `main` through a pull request, then delete and re-push the tag:

```bash
git tag -d v1.0.0 && git push origin :refs/tags/v1.0.0
git tag v1.0.0 <new-sha> && git push origin v1.0.0
```

Re-pushing a tag that already has a GitHub Release will not overwrite the release; delete
that first if it exists.
