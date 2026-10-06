# Deploying: two paths, chosen by the release

Blue/green and "take the downtime" are opposites — blue/green keeps both versions live, which is
exactly the overlap that makes a schema change unsafe. Both are wanted, so the release picks:

**A release with no migration — blue/green.** ECS shifts traffic to a new task set, bakes (two
minutes in qa, five in prod: `blue_green_bake_minutes`), and
rolls back by shifting back. Zero downtime, and the rollback is instant because the old task set
is still there. This is the common case.

**A release with a migration — downtime.** Scale the service to zero, snapshot the database, run
Liquibase as a one-off ECS task, deploy the new version, scale back up. Nothing old is running,
so nothing has to be backward-compatible and **expand-and-contract is not needed**.

**The image decides which.** It carries the changelog it expects as a label and a file; the
deployment compares that with the database and takes the corresponding path. Hibernate already
runs `schema-management.strategy=validate`, so a mismatch already fails fast — this makes it
fail before any traffic moves, and say why.

Deployment runs from GitHub Actions as the environment's technical user. No CodePipeline; the
prod gate is a protected environment, which is also what keeps the prod key unreadable from an
unapproved run.

The SPA deploys as `aws s3 sync` of a **release artifact**, the same way `openapi.yaml` is already
attached to each release. Rolling the frontend back is re-syncing the previous release, which is
why the build has to be an artifact rather than something rebuilt at deploy time.

**This half exists** (#119). `release.yml` attaches `taskfest-frontend-<version>.tar.gz`, the built
`dist/`, to every release, and **`deploy-frontend.yml`**, given an environment and a tag,
syncs it into that environment's site bucket as the deploy role.
It uploads in three passes so no viewer ever sees an `index.html` naming an asset that is not
there yet: the hashed `assets/` first, cached for a year and never deleted (a browser holding the
old page keeps working, and so does a rollback); then the remaining files, cached five minutes;
`index.html` last with `no-cache`, which under CloudFront's `CachingOptimized` policy means it is
held for its one-second minimum — so a release is visible at once and no invalidation is needed.

**The backend half exists too** (#181): **`deploy-backend.yml`**, started by hand with an
environment and a tag — which is also the rollback, with the previous tag — runs
`.github/scripts/deploy-backend.py` as the deploy role:

1. It resolves the release's image digest on Quay, and the task pulls
   `quay/ghilling/taskfest-backend:<version>@<digest>` through the account's ECR cache. Never
   `latest`: the cache can hand out a stale copy of a tag it has served before, which on
   2026-10-06 took two deployments to get past; a version it has not seen, pinned by digest,
   cannot be stale.
2. An environment that is **down** is skipped, with a note in the run summary and no failure.
3. A release whose **database changelog** (`backend/src/main/resources/db`) differs from the
   running version's is **stopped**, failing, before any traffic moves: that is the release the
   downtime path is for, and blue/green must not roll it out. The running version is read from
   its image tag; when that is `latest`, the previous release counts. This is the check the
   image-label design above describes, done in git instead — the downtime path itself is still
   to come.
4. Otherwise it registers a task definition that differs from the running one in the image
   only, points the service at it and waits until ECS reports it stable, bake included.

**Every release goes to qa by itself.** `release.yml` ends by calling both workflows for qa with
its own tag: the backend first, then the frontend once the backend job has succeeded. So a release
stopped for its migration does not put its frontend in front of the old API either, while a qa
that is down still gets the frontend — the site bucket outlives `down`. **prod is never deployed
automatically**: both workflows are started by hand for it, from the Actions tab, and wait at the
`prod` environment's approval gate. The same manual start deploys any release to qa again, or
rolls it back.

**Deep links** are a CloudFront Function on the default behaviour (`spa-routing.js`): a path whose
last segment has no dot gets `index.html`, and a path that names a file is passed through, so a
missing asset is still the bucket's 403. It replaces httpd's `FallbackResource`. CloudFront's
custom error responses would have been the usual way, and are not used because they apply to
every origin: `/api/*` errors would have become the app with a 200. While an environment is
**down** there is no `/api/*` behaviour, so API requests reach this function too; it answers them
with a plain 503, "The backend is not running in this environment", rather than the app — the
first deployment showed `/api/auth/providers` coming back as `index.html` with a 200 until it did.

