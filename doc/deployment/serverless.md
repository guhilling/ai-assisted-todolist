# Serverless: Lambda, Go and DynamoDB

**Status: being ported (#547).** Gunnar chose this direction on 2026-11-09 (#535), and the spike
that had to measure it first passed. Everything else in these deployment chapters still describes
what runs today: the container architecture, Quarkus on Fargate behind a load balancer with
PostgreSQL on RDS. That description stays when the port is done, as the alternative to this one, and
the git tag `pre-serverless` marks the last `main` before the move, for a rollback in the worst
case; the `rollback-tags` ruleset keeps anyone, administrators included, from deleting or moving it.

## Why

An environment costs about **$1.86 a day while it is up** ([cost.md](cost.md)), almost all of it
billed by the hour whether anyone uses it or not: the load balancer, the Fargate task, the
database instance and the task's public IPv4 address. So environments are taken down when idle,
and `env.sh up` and `down` are a daily chore that is easy to forget: qa once ran four days
unnoticed.

Serverless bills per request instead. At TaskFest's traffic, an environment that is **always up**
costs about **$1 to $1.50 a month**:

| | Price in eu-central-1 | At demo traffic |
| --- | --- | --- |
| Lambda, arm64 | $0.20 per million requests, $0.0000133334 per GB-second | inside the free tier |
| API Gateway HTTP API | $1.20 per million requests | cents |
| DynamoDB on demand | $0.7625 per million writes, $0.1525 per million reads; 25 GB free | cents |
| S3 for attachments | unchanged | cents |
| CloudFront, Route 53 | unchanged | the zone's $0.50 a month |
| CloudWatch Logs | $0.63 per GB after 5 GB free | cents |

Lambda's free tier is 1 million requests and 400,000 GB-seconds a month, account-wide, and does
not expire.

No load balancer, no NAT gateway, no VPC for the backend at all, and so no public IPv4 address.
Nothing to take down, and `prod` can simply stay up.

## The shape

```
  taskfest.cloud.hilling.de
            │
            ▼
       CloudFront ──── /*      ──> S3                  (the built SPA, unchanged)
            │
            └───────── /api/*  ──> API Gateway ──> Lambda (Go, arm64) ──> DynamoDB
                                    HTTP API              │
                                                          └──> S3 (attachments)
```

- **Four functions** (#554): `api` serves every route behind the HTTP API; `streams` follows the
  table's stream and deletes the files of attachments that go; `orphans` and `replay` run on a
  schedule. [The infrastructure](#the-infrastructure) says what each is given.
- **DynamoDB, one table.** The partition key is the user, `USER#<sha256 of the email>`; the sort
  key says what the item is: `META` for the user, `TASK#<id>`, `DRAFT#<id>`, `ATT#<id>`, and
  `SESSION#<key>` for each of the website's sessions, so that deleting the account ends them. A
  board is one `Query` on `TASK#`, and a draft, which is no task yet, never matches it. Task
  stays the aggregate the [domain model](../domain-model.md) says it is. The website's sessions
  and its sign-ins under way have partitions of their own, `SESSION#<key>` and `SIGNIN#<key>`
  ([Sign-in](#sign-in)).
- **The per-user limits** (five drafts, five attachments, two per task) are kept on the user's
  `META` item, changed in the same conditional transaction as the item they count. That replaces
  the row lock (`User.lockRow`). For drafts it is the open ones with their expiry, so that one
  TTL deletes stops counting without anything counting it down ([Drafts](#drafts)).
- **The sweeps** become DynamoDB TTL on drafts and detached attachments, with a stream handler
  that deletes their files from S3. The orphan sweep and the deletion replay run from
  EventBridge Scheduler.
- **The API contract stays.** `doc/api/openapi.json` is what the Go code is generated from and
  tested against, so the website and the apps do not notice the switch.

## The code

[`serverless/`](../../serverless/) is one Go module; its conventions are in
`serverless/CLAUDE.md`.

- **`cmd/api`** is the backend: one binary that serves API Gateway's events on Lambda and plain
  HTTP anywhere else, so that local development and the end-to-end tests can run the code Lambda
  runs. `internal/lambdahttp` turns one into the other. The end-to-end suite still builds the
  Quarkus backend until #556 moves it.
- **`cmd/streams`** deletes the files of attachment items that go, from the table's stream, and
  **`cmd/orphans`** is the hourly clean-up of files no item refers to ([Attachments](#attachments)).
- **`internal/api`** holds the routes and wire types, generated from `doc/api/openapi.json`, and
  the handlers. Every route is ported; one test checks that every route of the contract is
  served, and each route's tests check its responses against the contract.
- **`internal/board`** is the domain, with no AWS package in it; **`internal/store`** is DynamoDB,
  and **`internal/files`** the attachment bucket in S3.
- **`internal/auth`** is sign-in, below, and **`internal/gravatar`** the picture fallback.

Locally, against the Go backend's end-to-end stack
([end-to-end-stack.md](../local-development/end-to-end-stack.md#with-the-go-backend)), whose
DynamoDB Local is on port 8000, SeaweedFS on 8333 and Keycloak on 8082, with the stack's own
backend stopped (`docker compose -f deployment/docker/docker-compose.e2e.serverless.yml stop
backend frontend`):

```sh
cd serverless
TABLE_NAME=taskfest-local DYNAMODB_ENDPOINT=http://localhost:8000 AWS_REGION=eu-central-1 \
  AWS_ACCESS_KEY_ID=taskfest AWS_SECRET_ACCESS_KEY=taskfest-secret \
  TASKFEST_ATTACHMENTS_BUCKET=taskfest-attachments S3_ENDPOINT=http://s3.localhost:8333 \
  TASKFEST_AUTH_ENABLED=true TASKFEST_AUTH_PROVIDERS=keycloak TASKFEST_COOKIE_SECURE=false \
  TASKFEST_OIDC_KEYCLOAK_ISSUER=http://localhost:8082/realms/taskfest \
  TASKFEST_OIDC_KEYCLOAK_CLIENT_ID=taskfest-backend \
  TASKFEST_OIDC_KEYCLOAK_CLIENT_SECRET=taskfest-secret \
  TASKFEST_OIDC_KEYCLOAK_AUDIENCES=taskfest-app go run ./cmd/api
```

## Tasks

The board and creating, replacing and deleting a task (#550) keep every rule of the Quarkus
backend's `TaskResource`, and its tests are ported case for case: `internal/board` holds the
rules, `internal/api` the requests, `internal/store` the items.

- **Ids are counted per user**, by `lastTaskId` on the user's `META` item: an atomic `ADD`, then a
  `PutItem` that may not overwrite, stepping over an id a task written around the count holds. Two
  writes rather than one transaction, since a transaction cannot hand the counted id to its own
  `Put`; a create failing in between leaves a gap in the ids, and nothing minds one. A deleted
  task's id is not given again. Quarkus's ids are unique across all users; nothing relied on that.
- **Replace and delete are conditional** on the item existing in the caller's partition, so
  another user's task, or none, is a 404 and nothing is written. A replace that leaves out both
  the due time and the zone keeps them (#497) by not touching them in the `UpdateItem`.
- **Validation is Java's, not Go's**, where they differ. A description is blank as `String.isBlank`
  says (Hibernate Validator 9.1's `@NotBlank`) and measured in UTF-16 code units, as `@Size`
  measures it. A time in a daylight-saving gap moves later and one in an overlap takes the earlier
  moment, as `ZonedDateTime.of` does; Go's `time.Date` leaves that open.
- **Time zones are the names in Go's tzdata, exactly as written** (`zones.gen.go`), but for EST,
  MST, HST and ROC, which the JDK does not have and refuses. Compared name for name with JDK 25.0.5
  (tzdata 2026e), the one difference left is the other way round: the JDK still takes six
  `SystemV/` zones tzdata dropped long ago, which no browser or app sends.
- **What follows from later stories:** the function's role needs `dynamodb:GetItem`, `PutItem`,
  `UpdateItem`, `DeleteItem`, `Query`, `BatchWriteItem`, which deleting an account uses, and
  `ConditionCheckItem`, which IAM checks for each item of a transaction, and on the attachment
  bucket `s3:PutObject`, `GetObject`, `DeleteObject` and `ListBucket`, without which a `HEAD` of
  a missing file is a 403 rather than a 404. `serverless.tf` gives the API function's role exactly
  these (#554).
- **Keys are read as Jackson reads them:** exactly as written, so `"Description"` is no
  description, and of a key given twice the last one counts.
- **Jackson's leniencies about values are not copied.** It takes a number for a string
  (`"description": 5` was the task "5"), an enum's position for the enum (`"importance": 2` was
  `HIGH`), and a date as an array or a day count. The Go backend refuses each with a 400; no
  client sends one.

## Drafts

Starting, adding and discarding a draft (#551) keep the Quarkus backend's `DraftResource`, and
its tests are ported case for case; its files are [attachments](#attachments) like a task's.

- **A draft is a `DRAFT#<id>` item** with its id from the same count as tasks, so it keeps the id
  when it is added. Adding it is one transaction that deletes the draft and writes the task.
  Adding it again, a retry whose answer was lost (#427), finds no draft and sets the values on the
  task instead; a task that was never a draft takes them too, as in Quarkus. A start steps over an
  id a task written around the count holds, as a create does. Discarding a task's
  id is a 404, and the task stays.
- **The draft sweep is DynamoDB TTL** on `expiresAt`, an hour after the start, as long as an
  announced upload lasts. TTL deletes within about two days, so a draft past its `expiresAt` is
  gone to every read and write: adding or discarding it is a 404, and it no longer counts.
- **The limit of five is the open drafts on the `META` item**: an `openDraft#<id>` attribute per
  open draft, holding its expiry, and a `draftsVersion` that every change counts up. Attributes
  rather than one map, since removing a key from a map the item lacks is an invalid request. A start
  reads them, leaves out the expired ones, and writes the new set together with the draft, on the
  condition that the version is still the one it read. Two drafts started at once cannot both take
  the last place: one of the two transactions fails its condition, counts again and is refused; a
  test starts six at once with room for one. Adding and discarding take the draft off the set and
  count the version up in their own transaction, so a start that read the set before them cannot
  write it back.
- **A plain counter would not do**, since TTL deleting a draft would never count it down. Neither
  would counting the `DRAFT#` items with a `Query`: two starts at once would both count four.

## Attachments

A task's files and links (#552) keep the Quarkus backend's `AttachmentResource`, and its tests,
`AttachmentThumbnailTest`, `LinkAttachmentTest` and `DraftTaskTest` are ported case for case:
`internal/board` holds the rules, `internal/api` the requests against an in-memory store and
bucket, `internal/store` the items against DynamoDB Local, `internal/files` the signed links
against LocalStack with signature checking on. Files still travel straight between the browser
and S3, through presigned links signed for exactly the announced size and type, and the bucket is
the same one.

**The Go backend keeps to `serverless/` in it** (#578). Both backends run side by side for the
time being, each with its own database, and share each environment's bucket:

| | The containers' backend | The Go backend |
|---|---|---|
| Files | `<key>`, `<key>.thumbnail` | `serverless/attachments/<key>`, and `.thumbnail` |
| Deletion records | `deleted-accounts/<hash>` | `serverless/deleted-accounts/<hash>` |

Each orphan clean-up takes only its own files, and each replay only its own records, which it keeps
for as long as its own restores need them: the RDS snapshots for the one, DynamoDB's restore points
for the other. The Quarkus clean-up lists the whole bucket and leaves out every key with a slash,
so its code needed no change. IAM keeps them apart as well: the Go functions' roles reach objects
under `serverless/` only, and the containers' task role is denied them. Callers in the Go
code name a file by its bare key, and `internal/files` adds the prefix.

- **An attachment is an `ATT#<id>` item** with its id from `lastAttachmentId` on `META`, the
  id of the task or draft it is on, and its object's key: random, and with no slash, so the
  orphan clean-up lists it; stored under `serverless/attachments/`. A thumbnail is the same key
  with `.thumbnail`.
- **The sweeps are DynamoDB TTL** on the item's `expiresAt`, set for as long as it is not kept for
  good, whichever ends first: an upload not confirmed an hour after it was announced, a deleted
  task's attachment ten minutes after the delete, the undo window, and a draft's when the draft
  expires. A confirmed attachment on a task has none. Past it, an attachment is gone to every read
  and write and no longer counts, as for drafts. Deleting a task detaches its attachments in the
  same transaction, and the undo's `attachmentIds` puts them back on the new task; adding a draft
  makes its attachments a task's, and discarding it deletes their items in its transaction.
- **The limits are counted from the items.** A write reads `attachmentsVersion` on `META`, then
  the task or draft, then the user's `ATT#` items, strongly consistent, and writes with the
  condition that the version is still the one it read, counting it up. Every write to attachments
  does so, deleting a task and adding or discarding a draft included, so two files announced at
  once cannot both take the last place, and none is attached to a task deleted meanwhile; tests
  announce six at once with room for two, and race an attach against a draft's add. The draft is
  read before the task: a draft becomes a task, never the other way round.
- **The files of a deleted item go through the table's stream.** `cmd/streams` takes the
  stream's records, with old images, and deletes the file and thumbnail of every `ATT#` item that
  goes: removed, discarded with its draft, or deleted by TTL. A record whose files fail to go is
  answered as a failure; Lambda sends it and the shard's later records again, holding the shard
  until it succeeds, so the event source mapping caps the retries at five, and an hour's age, and
  lets the orphan clean-up take what is given up.
  Removing an attachment, and a mismatch on confirm, also delete the files at once, after the
  item; Quarkus deleted the file first, so that a failure in between left a row pointing at
  nothing rather than a file nobody could find. With the stream, neither order loses track of one.
- **The orphan clean-up is `cmd/orphans`**, which EventBridge Scheduler runs hourly. It reads every
  user's `ATT#` items with a `Scan`, the one read across partitions, lists the bucket, and keeps
  every rule of Quarkus's `OrphanPlan`, whose tests are ported: an object no item refers to goes
  after seven days; a table without a single file deletes nothing; more than two orphans older
  than an hour raise the alert, a JSON log line with `orphanSweepAlert`; an available attachment
  whose file is missing is logged, never deleted. Expired items still count as referring to their
  files, which are the stream's to delete. The alert line feeds the same alarm as the
  containers' ([the infrastructure](#the-infrastructure)).
- **A link to open a file is handed out again while half its hour is left**, as before, per Lambda
  instance rather than per backend task; with several instances, a browser sees a few URLs for a
  file at worst. Each link ends with the credentials that signed it, when they end first, and says
  so in its expiry, where the credentials tell their end. **On Lambda they do not:** the
  function's credentials come in environment variables, without an expiry. A link signed shortly
  before they lapse can stop working before the expiry it reports, and since the browser keeps
  it, a preview stays broken for up to half an hour, until the next link. Gunnar accepted that
  (#569) rather than signing anew on every request, which undoes #236, or signing with a role
  assumed for the purpose, which knows its end at the price of a role and an STS call per start.
- **Locally**, `TASKFEST_ATTACHMENTS_BUCKET` names the bucket and `S3_ENDPOINT` points at the
  end-to-end stack's SeaweedFS (#556); the Go code's own tests still start LocalStack.

## Sign-in

The Go backend signs in as the Quarkus backend does ([authentication.md](../authentication.md)),
with the same paths, callbacks included, so the redirect URIs registered at Google and Cognito
stay valid. The website signs in through the backend and gets a cookie; the apps send a bearer
ID token. Every provider must vouch for the email, a bearer token must have been issued to one
of the provider's named clients and be an ID token, and the provider list and the Gravatar
fallback are unchanged. The function checks bearer tokens itself, not API Gateway's JWT
authorizer: the cookie needs the function anyway, and one place decides for both.

Two things differ, by Gunnar's decision on #549:

- **The session is stored, not carried.** The cookie, `taskfest_session`, holds a random value;
  the session is the item `SESSION#<its SHA-256>`, so the table holds nothing that lets anyone
  in. Sign-out deletes it, so a copied cookie stops working too, which Quarkus's encrypted
  `q_session` did not. No chunked cookies, no encryption key. A sign-in under way is a
  `SIGNIN#` item, with its PKCE verifier and nonce, taken and deleted in one request by the
  callback, so a callback works once.
- **It is not renewed with the provider.** After a verified sign-in the session keeps the email,
  name and picture, and nothing of the provider's tokens. It ends after **eight hours without a
  request**, as before, and in any case **seven days after signing in**. There are no refresh
  tokens and no offline access, and nothing happens at the hour mark, where Quarkus's renewal
  once broke every sign-in; the price is that a withdrawn account stays signed in for up to
  seven days rather than an hour.

Both kinds of item carry `expiresAt`, the table's TTL attribute (#554), and the backend checks the
times itself as well, since TTL deletes late. A busy session
records its latest request at most every five minutes. A request with no or an ended session
gets a 401: Quarkus answered the website's scripts a 499 instead, and the frontend treats both
alike. A sign-in that fails at the callback (a second tab's, a callback used twice, one
cancelled at the provider) goes back to the app, signed out, rather than to Quarkus's blank 401.
Signing in or out also expires any `q_session` and `q_auth` cookie left from the Quarkus
backend.

## Deleting an account

`DELETE /api/account` (#553) keeps the
[decision](../decisions/domain-and-backend.md#deleting-an-account-leaves-a-record-outside-the-database)
and the Quarkus backend's tests: the record `serverless/deleted-accounts/<SHA-256 of the email>`
is written to the attachment bucket first, where a restore of the table cannot take it back, and
without a bucket an account is deleted without one. Two things differ, by Gunnar's decisions on
#553:

- **The account is marked, then deleted in batches.** A transaction holds at most 100 items, and a
  user's tasks have no limit, so no single write deletes an account. The first write sets
  `deletedAt` on `META`; then every item of the partition goes, 25 to a `BatchWriteItem`, and `META`
  last. A deletion that cannot be marked takes its record back and answers a 500, as before. One
  that stops after the mark counts as done: the user is told so, and the account's next request
  finishes it before anything else (`api.Settled`, one strongly consistent read of `META` per
  request, `/api/auth/me` included), or the replay does. A request is refused, with a 401, when that
  read fails or the deletion cannot be finished: it must never see what is left of a deleted
  account. The partition is read again until nothing is left, for what a request racing the deletion
  wrote, and once more after `META` is gone, under a marked `META` written on the condition that
  there is none, so an account begun anew in that moment stays. Should that last read fail, nothing
  in the table is marked any more; the record in the bucket is, and the replay deletes what is left
  under a recorded account that has no `META`. The stream deletes the attachments' files as their
  items go.
- **It ends the account's sessions on every device.** Each sign-in also writes a
  `SESSION#<key>` item into the user's partition, which deleting the account deletes along with
  the session it names; the item expires with the session's seven days. Quarkus's sessions were
  encrypted cookies, so a session left open elsewhere began a new, empty account; now it is
  signed out. The apps send a bearer ID token with every request, which no deletion can end:
  their next request uses a new, empty account, as before.

One gap is accepted, as in the Quarkus backend (Gunnar's decision on #572): two deletions of the
same account at the same moment share one record, and if one of them cannot be marked, taking its
record back also takes the other's. It needs both at once, a DynamoDB failure on exactly one, and
a later restore; closing it would take a conditional delete in S3 or a lock on the account.

### The replay

`cmd/replay` deletes again any account a restore brought back, and prunes the records no restore
can need any more; `internal/replay` keeps every rule of Quarkus's `DeletionReplay`, whose tests
are ported. EventBridge Scheduler runs it daily, at 03:30 Berlin time. Lambda has no start-up to
run it in, so the restore procedure below runs it once against the restored table **before the
API is switched to it**, and nobody can sign in to a restored account first (Gunnar's decision on
#553).

- **An account is deleted again only if it began before its deletion.** `META` carries
  `createdAt`, written with the first id the account counts and kept from then on; the write that
  marks the account deleted again is conditional on it, so an account begun anew since is never
  taken for the restored one. Times are whole seconds, and an account begun in the second of its
  deletion counts as before it: the deletion the user asked for wins (Gunnar's decision on #573).
  An account without `createdAt` counts as older; there is none, as
  the table starts empty and no user moves over from the Quarkus backend (#557). The Quarkus
  backend's records, under `deleted-accounts/`, are its own replay's and never this one's (#578):
  no account they name was ever in this table.
- **What a deletion left without `META` is deleted too**, for the deletion that stopped after
  `META` went: no task, draft or attachment is ever written without `META`. A marked `META` is
  written first, on the condition that there is none, so a sign-up at that moment either keeps
  its account or finds it marked and has it settled like any deletion left half-way. A session
  signed in after the deletion stays; each link carries when its session began. Finishing a
  deletion left half-way spares such a session as well, so signing in again in between does not
  sign out.
- **The replay deletes the attachments' files itself**, file and thumbnail, after their items: a
  restored table has no stream until the API is switched to it, and the orphan clean-up holds
  while the table has no file at all (Gunnar's decision on #573). What fails is left to the
  clean-up.
- **Each record is handled on its own**, and a run in which an account could not be deleted again
  fails, to be retried by the next. A record younger than five minutes is left to the request that
  wrote it, which may yet take it back and tell the user the deletion failed.
- **A record is pruned once it is older than the oldest point the table could be restored to**, by
  two days, unless its account is still there, and not if it was written again since it was read;
  that check and the delete are two requests, and a second deletion of the same address between them
  loses its record, a gap accepted like the one above (#573). The two days cover a deletion finished
  a day after its record, by the next daily run. That point is the start of any table's
  point-in-time recovery window in the region, or the oldest backup there, whichever is older: every
  table and backup counts, not only the table's, since a restore goes into a new table and the one
  it came from stays restorable until it is deleted, and a record kept too long costs nothing. When
  neither exists, or DynamoDB will not say, nothing is pruned. Point-in-time recovery is on for prod
  and off for qa (#553).
- **Its role** has `dynamodb:Query`, `GetItem`, `PutItem`, `UpdateItem`, `DeleteItem` and
  `BatchWriteItem` on the table, `DescribeContinuousBackups` on every table, `ListTables` and
  `ListBackups`, and on the bucket `s3:ListBucket`, `GetObject` under
  `serverless/deleted-accounts/`, and `DeleteObject` there and under `serverless/attachments/`
  (`serverless-jobs.tf`).

### Restoring the table

A DynamoDB restore always creates a new table; the old one stays until it is deleted. What was
written between the restore point and the switch is lost, as with the database's snapshot
restores ([database.md](database.md)), and files uploaded since are left to the orphan clean-up.
A restore is billed by the size restored, cents for TaskFest. Every step runs as the
administrator: with its profile, or the credentials exported from it in step 2.

1. **Restore into a new table**, from point-in-time recovery (prod) or a backup:
   ```bash
   aws dynamodb restore-table-to-point-in-time --source-table-name <table> \
     --target-table-name <table>-restored-<date> --restore-date-time <time>
   aws dynamodb restore-table-from-backup --backup-arn <arn> \
     --target-table-name <table>-restored-<date>
   aws dynamodb wait table-exists --table-name <table>-restored-<date>
   ```
2. **Run the replay against it**, before anything else can reach it. The Go program cannot ask
   for an MFA code, so the AWS CLI exports the administrator's credentials first, asking for one
   if it has none cached; nothing runs if that fails:
   ```bash
   creds=$(aws configure export-credentials --profile <admin profile> --format env) &&
     eval "$creds" && unset AWS_PROFILE &&
     (cd serverless && AWS_REGION=eu-central-1 TABLE_NAME=<table>-restored-<date> \
       TASKFEST_ATTACHMENTS_BUCKET=<bucket> go run ./cmd/replay)
   ```
   The credentials last as long as the CLI's cached session, at most an hour from when the profile
   was first used. Should step 5 fail with `ExpiredToken`, the export is run again.
   It logs one JSON line, `deletion-replay`, with how many accounts it deleted again; it exits
   non-zero when one could not be, and is then run again.
3. **Switch the functions to the new table**, as the administrator, in the environment's root.
   OpenTofu forgets the old table, which stays, protected from deletion, until it is deleted by
   hand; `table_name` in `terraform.tfvars` names the restored one; OpenTofu takes it over;
   deletion protection, which a restore does not carry over either, is set by hand on its own
   first; and the apply sets the rest a restore leaves out, TTL, the stream and point-in-time
   recovery, and points the functions, their roles and the stream's mapping at it:
   ```bash
   tofu state rm module.environment.aws_dynamodb_table.data
   # table_name = "<table>-restored-<date>" in terraform.tfvars
   tofu import module.environment.aws_dynamodb_table.data <table>-restored-<date>
   # Deletion protection first, alone. The apply would send it together with the stream, and
   # DynamoDB refuses that: "DeletionProtection modification must be the only operation in the
   # request" -- the apply then fails half done, as in the trial on #553. The profile and the
   # region are named because step 2 unset the one and set the other only for the replay.
   aws dynamodb update-table --profile <admin profile> --region eu-central-1 \
     --table-name <table>-restored-<date> --deletion-protection-enabled
   aws dynamodb wait table-exists --profile <admin profile> --region eu-central-1 \
     --table-name <table>-restored-<date>
   # Must print true before the apply; the waiter alone can return before the change shows.
   aws dynamodb describe-table --profile <admin profile> --region eu-central-1 \
     --table-name <table>-restored-<date> --query Table.DeletionProtectionEnabled
   ```
   and then `env.sh down` or `up`, whichever the environment is in, naming the administrator's
   profile for it, as `TASKFEST_<ENV>_AWS_PROFILE=<admin profile>`: after step 2 `AWS_PROFILE` is
   unset, and `env.sh` would fall back to the lifecycle role, which cannot apply this. The change
   of `table_name` reaches `main` just before, in a pull request; until this step has run, an apply
   of `main` would try to replace the old table and fail on its deletion protection.
4. **Redeploy the release that runs**, with `deploy-serverless.yml` and its tag: the apply changed
   the functions' settings, which reach what serves only as a newly published version (#555,
   [Deploying a release](#deploying-a-release)). Until then the API serves server errors for
   whatever needs the table: the apply has given its role the restored table, while the version
   that serves still names the old one. So this follows the apply at once; should it fail, the API
   stays down until it is run again, or until `table_name` is set back and applied.
5. **Run the replay again, now against the switched table, at least five minutes after the
   switch.** The run in step 2 passed over the deletions of its last five minutes, which may still
   have been under way, and deletions kept being recorded until the switch; this run takes both.
   Until it has run, an account deleted in those minutes is back. Deletions are not stopped
   during a restore, which would take the API down for its length; the window is minutes, and
   only for accounts whose owners have just deleted them (Claude's decision on #554, which Gunnar
   confirmed on 2026-11-12).

**Tried in qa on 2026-11-13** (#553), from an on-demand backup of `taskfest-qa-data` into
`taskfest-qa-data-restored-2026-11-13`, which qa has used since. An account was deleted after the
backup: it came back with the restore, the replay in step 2 deleted it again (`reapplied: 1`), the
one in step 5 found nothing more (`reapplied: 0`), and signing in afterwards began a new, empty
account. The restore took about five minutes. Two steps were found missing and are written in
above: exporting the CLI's credentials for the replay in step 2, and the deletion protection set on
its own before the apply in step 3, which had failed half done without it; set by hand, the apply
went through. The old table and its backup stay until deleted by hand.

## Why Go

Measured cold starts of a real request after a pause, from published benchmarks:

| | Cold start |
| --- | --- |
| Quarkus on the JVM | 3.3 s |
| Quarkus with SnapStart and priming | 0.6 to 1.0 s |
| Quarkus native | 0.56 to 0.72 s |
| **Go** | about 0.46 s for a real app (2021, at 128 MB); a bare start 45 ms today |
| Rust | about 0.12 s; a bare start 17 ms |

Warm requests take about 5 ms in all of them. A demo is idle most of the time, so most visits
start cold, and the cold start is what users notice. Go starts fast, compiles to one static
binary for arm64, and its AWS SDK is first-class. Rust starts faster still, but not by an amount
anyone would notice, at a far higher cost in writing it.

## What speaks against it

- **It ties the backend to AWS.** The handlers speak Lambda's event format, the data model is
  shaped by DynamoDB's access patterns, and sign-in, scheduling and clean-up lean on API
  Gateway, EventBridge and DynamoDB streams. Moving to another cloud would be a rewrite of the
  backend, where the container architecture moves almost as it is: a container, PostgreSQL and a
  load balancer exist everywhere. The domain logic is kept behind plain Go interfaces, so that
  the part worth keeping does not import an AWS package.
- **Go is new to the project, and Gunnar does not mean to learn it.** Claude writes and
  maintains the Go code; Gunnar reviews behaviour, not idiom. That makes the tests, the
  contract checks against `openapi.json`, `/code-review` and CodeRabbit carry more of the review
  than they do for the Java backend.
- **Cold starts.** Rare for a busy service, normal for a demo: see above.
- **DynamoDB is not relational.** Every access pattern is designed up front, a new query can
  mean a new index, and there are no ad-hoc SQL queries for support.
- **The blue/green demonstration goes.** ECS shifts traffic between two target groups; Lambda's
  equivalent is a weighted alias, which is simpler and shows less.
- **Local development changes.** LocalStack Community, which the end-to-end stack uses, was
  archived in March 2026. Amazon's own DynamoDB Local replaces it for the database.
- **The website's sign-in is the hardest part.** Quarkus keeps the website's session in an
  encrypted cookie (`q_session`) after an authorization-code flow; the apps send a bearer ID
  token. Go has to rebuild the first, or the website moves to signing in the browser. Decided
  during the port, not by the spike.

## The spike first

Before anything is ported, one endpoint, `GET /api/tasks`, is built in Go and run in qa beside
the current backend, to measure the cold start in Frankfurt rather than trust benchmarks:

- One Lambda function on `provided.al2023`, arm64, and one DynamoDB table, created only where
  `serverless_spike` is true (qa).
- No API Gateway and no sign-in yet: the function is invoked directly with the event API
  Gateway would send, including the claims its JWT authorizer would pass on.
- **It succeeds** if a cold invocation, initialisation included, takes **under 500 ms** at
  256 MB, and a warm one under 50 ms. **It fails** if not, and Quarkus with SnapStart is then
  the fallback, in the language Gunnar knows. It passed at 512 MB instead
  ([below](#what-the-spike-measured)).
- It costs nothing measurable: about a hundred invocations and a table of twenty items.

The spike's function and table, and `serverless/spike/measure.sh`, which uploaded the code, wrote
twenty tasks for the test account `taskfest-test-one@example.com` and printed Lambda's own
initialisation, cold and warm times, were removed with #554, which replaced them with
[the infrastructure](#the-infrastructure). They are in the git history before it.

## What the spike measured

Run on 2026-11-10 in qa: five forced cold starts per memory size, each followed by three warm
calls, all reading the board of twenty tasks. Times in milliseconds, from Lambda's REPORT lines.

| Memory | Initialisation | First call | Cold, together | Warm | Memory used |
| --- | --- | --- | --- | --- | --- |
| 128 MB | 58–70 | 1015–1159 | about 1100 | 3–5, two at 50 | 34 MB |
| 256 MB | 57–70 | 432–545 | 490–615 | 3–5 | 35 MB |
| **512 MB** | 58–72 | 180–265 | **240–340** | 3–5 | 38 MB |

- **The function runs at 512 MB.** It passes there; at 256 MB it missed the 500 ms in four rounds
  of five. Lambda bills by memory and time, so 512 MB costs twice as much per millisecond, which
  at a demo's traffic is still inside the free tier.
- **Initialisation is flat, the first call is not.** The first call halves each time the memory
  doubles, and Lambda gives CPU in proportion to memory, so it waits on CPU: most likely the DNS
  lookup and TLS handshake of the first DynamoDB request. Not measured separately; opening that
  connection during initialisation is the first thing to try in the port.
- **Warm calls take 3 to 5 ms**, and the function never used more than 40 MB.

That is ten times faster than the JVM on Lambda without SnapStart, and faster than Quarkus with
it, so the port goes ahead in Go, at 512 MB.

### With the connection opened during initialisation

Run again on 2026-11-10 with the foundation (#548): `cmd/api`, which queries DynamoDB once while
it initialises (`Store.Prime`).

| Memory | Initialisation | First call | Cold, together | Warm | Memory used |
| --- | --- | --- | --- | --- | --- |
| 256 MB | 115–148 | 4–45 | **120–190** | 3–5, one at 16 | 34 MB |
| 512 MB | 120–142 | 4–5 | **125–146** | 3–8 | 39 MB |

- **The guess was right.** Initialisation grew by about 70 ms and stayed the same at both sizes,
  and the first call dropped from hundreds of milliseconds to a warm call's few. Lambda's
  initialisation is evidently not held to the CPU share of the memory size, so work moved there
  gets done faster.
- **A cold request now takes under 200 ms even at 256 MB**, well inside the 500 ms gate. The
  function stays at 512 MB: the routes still to come do work no priming covers, such as fetching
  a sign-in provider's keys, and at TaskFest's traffic the difference costs nothing.

## The infrastructure

`serverless.tf` and `serverless-jobs.tf` in `deployment/aws-tofu/modules/environment/` (#554), in
both environments alike. All of it is foundation, which `env.sh down` leaves: the functions, the
API and the table bill per request, and the alarms, $0.10 a month each, are the one fixed cost.

- **The table**, `<project>-<env>-data`, on demand. TTL on `expiresAt` deletes ended sessions,
  sign-ins under way and session links; the stream carries what a deleted item held, for the
  `streams` function; point-in-time recovery is on in prod, for [restoring](#restoring-the-table),
  at fractions of a cent a GB-month, and off in qa (`table_point_in_time_recovery`, #553); and
  deletion protection keeps a destroy of the foundation from taking people's data with it.
- **The `api` function**, arm64, 512 MB ([measured](#what-the-spike-measured)), with a timeout
  of 28 seconds, under the HTTP API's own 30. Its role reaches its own table, its part of the
  attachment bucket, the Google client secret and its log group, nothing else.
- **The HTTP API** sends every request to it. Its address is public, so CloudFront adds a header
  with a secret, `X-Origin-Verify`, and the function refuses any request without it with a 403
  (`lambdahttp.FromOrigin`); OpenTofu generates the secret. A Secrets Manager secret would cost
  $0.40 a month to prove only where a request came from, so it is in state and in the function's
  settings instead. The stage is throttled at 50 requests a second, bursts of 100, as a ceiling on
  what a flood could cost.
- **CloudFront** has the HTTP API as a second `/api/*` origin, always, without the viewer's
  `Host`, which API Gateway would refuse: the function takes its own address from
  `TASKFEST_PUBLIC_ORIGIN`. `api_backend` in `terraform.tfvars` says which origin `/api/*` uses:
  `serverless` in qa since 2026-11-12, to try it (#557); `containers` in prod until its cut-over.
- **Sign-in** is configured as for the containers: on only where Google's client id is set, and the
  test accounts beside Google where they exist. Google's client secret stays out of OpenTofu: the
  function's setting `TASKFEST_OIDC_GOOGLE_CLIENT_SECRET_ARN` names the secret, and the function
  reads it once at a cold start (`internal/secrets`). The test accounts' secret is in state already
  (D4 on #141).

**The background functions** are in `serverless-jobs.tf`, each with a role for exactly what it
does:

- `streams` gets the table's stream, filtered to the removals of `ATT#` items, so no other write
  invokes it, with at most five retries and records at most an hour old.
- `orphans` runs hourly and `replay` daily at 03:30 Berlin time, on EventBridge Scheduler, which
  is free at two schedules. A failed run is not tried again; the next run does the same work.
- Both run whichever backend serves `/api/*`: they touch only `serverless/` in the bucket. Before
  that prefix (#578), `orphans` called qa's six container files orphans on its first run and
  raised the alarm, and `replay` would have pruned the containers' deletion records, so #577 had
  switched both off for a day.
- The Go orphan clean-up's alert line feeds the containers' metric through a second filter, so
  the one orphan alarm sees both backends.

**The alarms**, each $0.10 a month, mail through the existing topic on entering ALARM and on leaving
it: the API function's errors and throttles, the API's server errors, at least five in one five-
minute period (#558, Gunnar's threshold), the stream function more than ten minutes behind (it
reports a failed record rather than failing, so its errors would never show one), the scheduled
functions' errors, and the table's throttled reads and writes. That is eight per environment, about
$1.60 a month for both.

**The dashboard** `taskfest-<env>-go-backend` (#558, `serverless-dashboard.tf`) shows the requests
and their answers, the time they take, the API function's time, errors and throttles, the jobs'
runs and errors, how far the stream function is behind, and the table's reads, writes and throttles.
It is free: CloudWatch includes three dashboards per account, and these are the second and third.

The functions are created from `serverless/dist/<command>.zip`, which `serverless/build.sh` makes,
with Go where it is installed and the official Go image through podman or docker where it is not.
OpenTofu uploads the code only when it creates a function; a release deploys its own (#555).

Applying it needs the administrator, since the lifecycle role, `env.sh`'s default, cannot create
IAM roles, functions or tables. From the repository root on `main`:

```sh
serverless/build.sh
(cd deployment/aws-tofu && TASKFEST_QA_AWS_PROFILE=<admin profile> ./env.sh down qa)
```

**`down` takes qa down if it is up**; with qa down it applies only the foundation, and the plan
it shows says what that is before anything happens.

### Deploying a release

**A release deploys the code** (#555), as it deploys the containers' image and the site:

- **`release.yml` builds the four functions once**, from the tag, with the version `GET /api/version`
  reports, and attaches them to the release as `taskfest-serverless-<version>-<function>.zip`.
- **`deploy-serverless.yml` deploys them**, to qa after every final release, and to prod by hand
  through its protected environment, as the containers are. `deploy-serverless.py` uploads each
  function's zip, publishes it as a version described by the release, and moves the function's
  alias `live` to it. API Gateway, the stream and the schedules invoke `live`, never the
  unpublished code, so nothing serves a version before its alias moves.
- **The API's new version is checked first.** It is invoked with a request as API Gateway sends one,
  without CloudFront's header, which it must refuse with a 403: it has started, read its settings
  and secrets, and handled a request. It does not prove the table is reached -- the function starts
  even when its first read of the table fails, so that a moment's trouble does not fail a cold
  start. A release that cannot reach it answers 500s, which the server-error alarm reports only at
  five in one five-minute period: at TaskFest's traffic it may stay quiet, so after a deploy the
  dashboard's answers are the place to look. Anything else stops the deploy with every alias where
  it was. The jobs are not invoked, since a run does real work; a failing one raises its alarm.
- **A failure after an alias has moved tries to move every alias back**, each on its own, so the
  functions do not stay on different releases. The aliases move one after another, so for the
  seconds of a deploy they do anyway; and should moving one back fail too, the log names it, and
  `aws lambda update-alias --function-name <name> --name live --function-version <version>`, with
  the administrator, puts it where the log says it was. **A rollback** is `deploy-serverless.yml`
  with the previous release's tag.
- **The deploy role** may upload, publish, invoke and move the aliases of these four functions, and
  nothing else of them: no setting, no permission.
- **A change of the functions' settings by OpenTofu reaches what serves only through a deploy.** A
  published version keeps the settings it was published with, and the aliases name versions, so an
  apply changes the unpublished code's settings alone. After an apply that changes them -- a
  restored table, the origin secret, sign-in -- run `deploy-serverless.yml` with the release that
  runs; it publishes them with the same code.

**A traffic-weighted canary was decided against** (#555,
[the decision](../decisions/deployment-and-aws.md#the-go-backend-is-deployed-by-moving-an-alias-after-a-check)).

**A function created by OpenTofu** starts with what `build.sh` made, and its alias on that
unpublished code. The first deploy pins the alias on a published version of it before uploading
anything, so the upload does not serve the new code before its check. Code that changes what the
functions may touch goes out with the release after the apply that changes their roles, or by hand
before it, with the administrator, as #578's did:

```sh
for env in qa prod; do
  for c in api streams orphans replay; do
    AWS_PROFILE=<admin profile> aws lambda update-function-code --region eu-central-1 \
      --function-name "taskfest-$env-$c" --zip-file "fileb://serverless/dist/$c.zip" >/dev/null
  done
done
```

Once a release's deploy has pinned the aliases on published versions, code uploaded so changes the
unpublished code only, and the aliases keep their version until a deploy moves them. **Before the
first deploy, the aliases are still on the unpublished code**, as OpenTofu creates them, and an
upload serves at once, unchecked.
