# The database

**Migration** is a one-off ECS task running Liquibase, never the application. `migrate-at-start`
stays on for dev and test, where overlap cannot happen, and off everywhere else.

**Rollback of a migration is a snapshot restore**, taken immediately before the migration ran.
Liquibase rollbacks exist and are not exercised here; a restore is the honest answer and it costs
the downtime that this deployment model already accepts.

**The deploy takes that snapshot itself** (#215): a release with a migration stops the backend,
snapshots the database as `taskfest-<env>-db-pre-release-<release>-<time>`, and only then migrates
([deploying.md](deploying.md)). The newest three such snapshots per environment are kept and older
ones deleted by the deploy; final snapshots are never touched by it. **To restore one** — after a
migration that failed, or a release that has to go — take the environment down and bring it up on
the release that ran before, from that snapshot:

```bash
deployment/aws-tofu/env.sh down qa
deployment/aws-tofu/env.sh up qa v1.2.2 --from-snapshot=taskfest-qa-db-pre-release-v1-2-3-20261008-201530
```

`down` leaves a final snapshot of the migrated database as usual, so nothing is lost by trying.
What was written between the snapshot and the restore is gone with it — little, since the backend
was stopped in between — except that account deletions are replayed at start (#213); attachment
files are the case below.

**`task_state` and `task_importance` are native PostgreSQL enums**, and `ALTER TYPE … ADD VALUE`
cannot be rolled back at all. A release adding an enum value is one-way: it must ship before
anything uses the value, and the only way back is the snapshot. That is the price of the enum
decision in [decisions/domain-and-backend.md](../decisions/domain-and-backend.md), and it is the sharpest edge in this plan.

**Idle cost** is handled by destroying the environment, database included, with a final snapshot.
Stopping is not enough: a stopped RDS instance still bills storage *and AWS restarts it
automatically after seven days*.

**A down/up cycle keeps the data, not the instance.** `env.sh down` destroys the instance and
leaves a final snapshot named `taskfest-<env>-db-final-<timestamp>`; `env.sh up` looks up the
newest one and passes it as `db_restore_snapshot`, so the new instance starts from it. With no
snapshot it starts empty, and it says which on screen. To start empty on purpose, or from an
older snapshot, pass `--from-snapshot=<name>` to `up`, or run the plan by hand with
`-var db_restore_snapshot=null` to start empty. `up` restores only *final* snapshots by itself;
the pre-release ones above are each the state before some release, and restoring one unasked would
drop everything since. Final snapshots are never deleted automatically; at this size each is cents
a month, and old ones are removed in the console when wanted.

**Starting empty or from an older snapshot costs attachment files.** The attachment bucket
survives `down` and is not versioned, and the orphan clean-up deletes, after seven days, every file
no attachment refers to ([attachments.md](attachments.md)). From an older snapshot, the files
written since it was taken are such files. Started empty, the clean-up deletes nothing until the
first attachment exists -- and then every file older than seven days on its next hourly run. The
orphan alarm mails within the hour either way; put the right snapshot back before the files go.

**The application logs in with IAM, not a password.** The ECS task role
(`taskfest-<env>-task`) may `rds-db:connect` as one database user, `taskfest_<env>`, and
nothing else. On every new connection `RdsIamCredentialsProvider` signs a token from the task
role's credentials, valid for 15 minutes; RDS checks it against IAM. Nothing secret is configured,
injected or rotated, and the counterpart on EKS would be a service account. The backend switches
it on with `TASKFEST_DATASOURCE_CREDENTIALS_PROVIDER=rds-iam`; without it, as in the Compose stacks,
the password is used as before. Migrations run as the same user.

**The master password is RDS's, and is for bootstrapping only.** `manage_master_user_password`
has RDS generate it, keep it in Secrets Manager and rotate it every seven days, so it is never in
state. Injecting it into the running service was rejected for exactly that rotation: ECS reads a
secret once, at task start, so a long-running task would keep the old password and fail on its
next connection after a rotation.

**Creating the database user happens once per environment, inside `up`.** `taskfest_<env>` does
not exist until the master user creates it, and nothing outside the VPC can reach the database to
do that, so it is a one-off ECS task. `up` runs it whenever there was no snapshot to restore from,
then the migration, and only then starts the backend:

```sh
./env.sh up qa             # apply; db-bootstrap if the database started empty; migrate; start
./env.sh db-bootstrap qa   # the same steps by hand, should one need repeating
./env.sh migrate qa
```

**Why `up` starts the backend last.** Before it did, the first `up` of a brand-new environment
failed: it waited for the service, whose backend could not log in as a user that did not exist yet
(`FATAL: password authentication failed for user "taskfest_qa"`), and because it was the service's
first deployment ECS had nothing to roll back to and stopped with *No rollback candidate was
found*. That happened when the environments were rebuilt under the TaskFest name (#128). A release
with a migration would have failed the same way, on Hibernate's schema validation. The service is
now created with no tasks and scaled up by `up` once the database is ready
([deploying.md](deploying.md)).

`db-bootstrap` runs `psql` from the official PostgreSQL image (pulled from ECR Public's mirror,
which has no Docker Hub rate limit) with the SQL in `modules/environment/db-bootstrap.sql`. It is
the only task that receives the master credentials, and the only one the deploy role cannot run.
It verifies the server with the region's RDS CA bundle, which is committed under
`modules/environment/rds-ca/` and passed in as a variable, because the image does not carry it.
Every statement is idempotent, so running it again — or on a restored database, which already has
the user — changes nothing. It is needed once per environment: every later `up` restores the user
along with the data.

`migrate` is the backend image with `quarkus.init-and-exit`, so Quarkus runs Liquibase and stops
instead of serving. It logs in exactly as the application will, with `verify-full` against the RDS
bundle that `backend/src/main/jib/opt/rds/` puts in the image, so a run that exits 0 proves the
whole path: the user exists, RDS accepts the token, and the certificate checks out. Both commands
print the task's log and exit with its exit code. The tasks run `quay.io/ghilling/taskfest-backend:latest`, pulled through ECR's cache ([image scanning](image-scanning.md)),
until the deploy change pins a release.

**A restore needs its managed password re-established.** For PostgreSQL, RDS cannot turn on
managed credentials during a snapshot restore — AWS supports that for Oracle only — so a restored
instance comes back with the master password from the time of the snapshot, whose secret was
deleted with the old instance. The AWS provider follows the restore with a `ModifyDBInstance`
that turns managed credentials back on and creates a new secret. That is expected rather than
verified; if the first restore shows no `db_master_secret_arn`, the fallback is
`aws rds modify-db-instance --db-instance-identifier taskfest-<env>-db --manage-master-user-password --apply-immediately`.

