# Deploying: the Go backend, then the site

A release deploys the Go backend, a version of each function published and its alias moved after a
check ([serverless.md](serverless.md#deploying-a-release), #555), and the site after it. Until
#559 it also deployed the containers' backend, Quarkus on ECS, with `deploy-backend.yml`: blue/green
for a release without a database migration, and a downtime path with a snapshot and a Liquibase
task for one with. That workflow and its script went with the Quarkus backend; the tag
`pre-serverless` keeps them, and this page in that tag describes them.

Deployment runs from GitHub Actions as the environment's technical user. No CodePipeline; the
prod gate is a protected environment, which is also what keeps the prod key unreadable from an
unapproved run.

The SPA deploys as `aws s3 sync` of a **release artifact**, the same way `openapi.yaml` is already
attached to each release. Rolling the frontend back is re-syncing the previous release, which is
why the build has to be an artifact rather than something rebuilt at deploy time.

**The site** (#119). `release.yml` attaches `taskfest-frontend-<version>.tar.gz`, the built
`dist/`, to every release, and **`deploy-frontend.yml`**, given an environment and a tag,
syncs it into that environment's site bucket as the deploy role.
It uploads in three passes so no viewer ever sees an `index.html` naming an asset that is not
there yet: the hashed `assets/` first, cached for a year and never deleted (a browser holding the
old page keeps working, and so does a rollback); then the remaining files, cached five minutes;
`index.html` last with `no-cache`, which under CloudFront's `CachingOptimized` policy means it is
held for its one-second minimum — so a release is visible at once and no invalidation is needed.
Just before it goes **`environment.json`** (`{"name":"QA"}`, also `no-cache`): the build is the
same in every environment, so the deploy is what tells the page where it is, for the page shown
while the environment is paused ([teardown.md](teardown.md)).

**`down` and `up` remain for what they are for:** pausing an environment, and starting one again on
a named release ([teardown.md](teardown.md)). `up` creates the backend service with **no tasks**,
so nothing starts against a schema it does not expect: Hibernate's validation would stop every
task, and the circuit breaker would fail the service's first deployment. After the apply it
creates the database's application user if the database started empty (`db-bootstrap`,
idempotent), runs `migrate` on the release's own image, and only then scales the service to its
task count (`backend_task_count`) and waits until it is serving. An `up` on an environment that is
already up does the same harmlessly: the migration runs the image already running and finds
nothing to do, and the count is what it was — tofu ignores it once the service exists. `env.sh`
never touches the frontend; the site bucket outlives `down`, so after an `up` on a release the
environment did not run before, deploy that release's frontend too
(`gh workflow run deploy-frontend.yml -f environment=qa -f version=v1.2.3`), which also runs the
live checks on qa.

**`up` needs a release that has a backend image.** Releases since #559 publish none, so until the
containers' infrastructure is removed, `up` has to be given the newest release from before it:
`deploy-backend.py --print-image`, which `env.sh` asks, looks that release's image up on Quay.

**Every release goes to qa by itself** — every final one: a pre-release (`v1.2.3-rc.1`) is
deployed by hand when wanted. `release.yml` ends by calling the workflows for qa with its own tag:
the Go backend first, `deploy-serverless.yml` ([serverless.md](serverless.md#deploying-a-release)),
then the frontend once it has succeeded, so a backend deploy that fails does not put its frontend
in front of the old API. **prod is never deployed automatically**: both workflows are started by
hand for it, from the Actions tab, and wait at the `prod` environment's approval gate. The same
manual start deploys any release to qa again, or rolls it back. **After every deploy of the
frontend to qa the [live checks](../testing/live.md) run** against the environment itself; a
failure fails the deploying run, and rolls nothing back.

**The approval gate is settings, not code**: *Settings → Environments → `prod`*, with Gunnar as
required reviewer and deployments allowed from `main` and `v*` tags only. Nothing creates it — a
job naming an environment that does not exist gets one made on the spot, unprotected — so the
first prod deploy, on 2026-10-18, ran ungated before the rules were added. `qa` and the live
checks' `qa-live-test` admit the same `main` and `v*` tags, with no reviewer (2026-10-31): the
deploy and live-test roles trust a job by its environment's name, so without the rule a workflow
pushed on any branch could deploy to qa.

**Deep links** are a CloudFront Function on the default behaviour (`spa-routing.js`): a path whose
last segment has no dot gets `index.html`, and a path that names a file is passed through, so a
missing asset is still the bucket's 403. It replaces httpd's `FallbackResource`. CloudFront's
custom error responses would have been the usual way, and are not used because they apply to
every origin: `/api/*` errors would have become the app with a 200. While an environment is
**down**, and the containers serve its `/api/*`, there is no `/api/*` behaviour, so API requests
reach this function too; it answers them with a plain 503, "The backend is not running in this
environment", rather than the app — the first deployment showed `/api/auth/providers` coming back
as `index.html` with a 200 until it did.

