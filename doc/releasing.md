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

## What the workflow does

| Job | What it does |
| --- | --- |
| `gate` | Derives the version, refuses a tag that is not on `main`, then runs the full backend `verify` and the full frontend suite at the release version |
| `publish` | Builds and pushes `todo-backend` and `todo-frontend` to Quay, tagged with the version |
| `announce` | Creates the GitHub Release, with notes generated from the pull requests since the previous release |

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
