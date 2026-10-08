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
Just before it goes **`environment.json`** (`{"name":"QA"}`, also `no-cache`): the build is the
same in every environment, so the deploy is what tells the page where it is, for the page shown
while the environment is paused ([teardown.md](teardown.md)).

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
   running version's takes the **downtime path**, below: blue/green must not roll it out. The
   running version is read from its image tag; when that is `latest`, the previous release
   counts. This is the check the image-label design above describes, done in git instead.
4. Otherwise it registers a task definition that differs in the image only from the
   **configuration last applied** — the newest active revision the deploy role did not register
   itself, usually tofu's (#189) — points the service at it and waits until that deployment's
   rollout has completed, bake included — up to 30 minutes, where ECS's own waiter would give up
   after ten.

**The downtime path** (#215) is the same workflow, taking four steps instead of one, each reported
in the run summary:

1. **stop** — scale the service to zero and wait until no task runs (up to ten minutes);
2. **snapshot** — take a manual snapshot of the database, `taskfest-<env>-db-pre-release-<release>-<time>`,
   and wait until it is available (up to 45 minutes; a demo-sized database takes a few). It is the
   way back. Once a deploy has succeeded, the newest three per environment are kept and older ones
   deleted ([database.md](database.md)) — not before, or retrying a failed migration three times
   would delete the one clean snapshot the first failure named;
3. **migrate** — register a revision of the `migrate` task with the release's image, run it in the
   service's own network, and wait for exit 0 (up to 20 minutes);
4. **start** — register the release's task definition as in step 4 above, point the service at it,
   scale back to the task count it had, and wait until the rollout has completed. The circuit
   breaker's rollback is off for this one deployment and put back afterwards: what it would roll
   back to is the old version, on the migrated schema.

The downtime runs from the stop until the release's tasks pass their health checks and take the
traffic: the snapshot and the migration, plus a start, usually a matter of minutes.
**What a failure leaves depends on whether the schema has changed yet.** A failure while stopping
or snapshotting restarts the old version, whose schema is untouched. From the migration on, the
service stays at **zero**: the old version must not run against a migrated schema, and neither
against a half-migrated one. The summary names the snapshot, and the way back is a restore
([database.md](database.md)) or a fix and another deploy. A start that fails after a successful
migration is treated the same way. A migrate task that was never placed changed nothing and
restarts the old version; one the deploy gave up on is stopped, so it cannot overlap a restore.
Cancelling the run is a failure of the step it interrupts. The polls retry a failed AWS call
rather than mistaking throttling for a failed step, and the deploy role's session lasts two hours
so the credentials outlive the longest wait.

**A rollback across a migration is refused.** Deploying an older release whose changelog differs
from the running one's fails before anything stops: its Liquibase would leave the newer schema as
it is, exit 0, and the old version would start against it. The way back over a migration is the
snapshot restore in [database.md](database.md). A rollback without a migration is an ordinary
blue/green deploy, as before.

**prod's approval says when it means downtime.** Before the approval, a job without credentials
(`Migrations`) asks the environment which release it runs — `GET /api/version`, public, over the
environment's own hostname — compares the release's changelog with that one, and names the deploy
job after the answer: `Deploy to prod WITH DOWNTIME (database migration)`. Reading what runs from
AWS would need the credentials the approval guards; the version endpoint needs none. When the
environment says nothing — it is down, or runs a release from before the endpoint — the job
compares with the previous release instead and says so in its summary. Either way the deploy
itself compares with what runs, and decides.

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

**Rolling out a configuration change.** The service ignores `task_definition` in tofu, so an apply
that changes the backend's environment, secrets, CPU or memory registers a new revision and leaves
the service running the old one — on purpose: applies are a person's, deploys the workflow's. The
next deploy picks the change up, because it copies the configuration last applied — found by who
registered each revision (`registeredBy`), not by the highest number, so an apply that lands while
a deploy runs is not buried under the deploy's copy. Until #189 a deploy copied the running
revision and silently dropped the change. To roll a change out without a release, run
`deploy-backend.yml` with the version that is running: it keeps that exact image and changes only
the configuration, blue/green as usual; the run summary says which revision's configuration it
carried.

**Configuration and releases are separate, and a rollback does not undo a configuration.** Every
deploy — a release, a configuration rollout, a rollback to the previous tag — runs with the
configuration last applied. A bad configuration is undone the way it was made: apply the previous
one, then deploy. An old release that cannot run with a newer configuration (a variable it reads
was renamed, say) needs the old configuration applied before it is rolled back to.

**Every release goes to qa by itself** — every final one: a pre-release (`v1.2.3-rc.1`) is
deployed by hand when wanted. `release.yml` ends by calling both workflows for qa with its own tag: the backend first, then the frontend once the backend job has succeeded. So a release with a
migration ends with its own frontend in front of it, one whose backend deploy failed does not put
its frontend in front of the old API, and a qa that is down still gets the frontend — the site bucket outlives `down`. **prod is never deployed
automatically**: both workflows are started by hand for it, from the Actions tab, and wait at the
`prod` environment's approval gate. The same manual start deploys any release to qa again, or
rolls it back. **After every deploy to qa the [live checks](../testing/live.md) run** against the
environment itself; a failure fails the deploying run, and rolls nothing back.

**Deep links** are a CloudFront Function on the default behaviour (`spa-routing.js`): a path whose
last segment has no dot gets `index.html`, and a path that names a file is passed through, so a
missing asset is still the bucket's 403. It replaces httpd's `FallbackResource`. CloudFront's
custom error responses would have been the usual way, and are not used because they apply to
every origin: `/api/*` errors would have become the app with a 200. While an environment is
**down** there is no `/api/*` behaviour, so API requests reach this function too; it answers them
with a plain 503, "The backend is not running in this environment", rather than the app — the
first deployment showed `/api/auth/providers` coming back as `index.html` with a 200 until it did.

