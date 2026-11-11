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

- **One Lambda function per concern or one for the API** is decided during the port; the spike
  has one handler.
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
  the handlers. A route not ported yet answers 501. One test checks that every route of the
  contract is served, and each ported route checks its responses against the contract.
- **`internal/board`** is the domain, with no AWS package in it; **`internal/store`** is DynamoDB,
  and **`internal/files`** the attachment bucket in S3.
- **`internal/auth`** is sign-in, below, and **`internal/gravatar`** the picture fallback.

Locally, with DynamoDB Local on port 8000 and a table created in it, and the end-to-end stack's
Keycloak on port 8082:

```sh
cd serverless
TABLE_NAME=<table> DYNAMODB_ENDPOINT=http://localhost:8000 AWS_REGION=eu-central-1 \
  AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local \
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
  a missing file is a 403 rather than a 404. The spike's role has none of them but `Query`
  (#554).
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
  rather than one map, since removing a key from a map the item lacks is an invalid request. A start reads them, leaves out the expired ones, and
  writes the new set together with the draft, on the condition that the version is still the one
  it read. Two drafts started at once cannot both take the last place: one of the two transactions
  fails its condition, counts again and is refused; a test starts six at once with room for one.
  Adding and discarding take the draft off the set and count the version up in their own
  transaction, so a start that read the set before them cannot write it back.
- **A plain counter would not do**, since TTL deleting a draft would never count it down. Neither
  would counting the `DRAFT#` items with a `Query`: two starts at once would both count four.

## Attachments

A task's files and links (#552) keep the Quarkus backend's `AttachmentResource`, and its tests,
`AttachmentThumbnailTest`, `LinkAttachmentTest` and `DraftTaskTest` are ported case for case:
`internal/board` holds the rules, `internal/api` the requests against an in-memory store and
bucket, `internal/store` the items against DynamoDB Local, `internal/files` the signed links
against LocalStack with signature checking on. Files still travel straight between the browser
and S3, through presigned links signed for exactly the announced size and type, and the bucket is
unchanged.

- **An attachment is an `ATT#<id>` item** with its id from `lastAttachmentId` on `META`, the
  id of the task or draft it is on, and its object's key: random, and with no slash, so the
  orphan clean-up lists it. A thumbnail is the same key with `.thumbnail`.
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
  until it succeeds, so #554 caps the retries and lets the orphan clean-up take what is given up.
  Removing an attachment, and a mismatch on confirm, also delete the files at once, after the
  item; Quarkus deleted the file first, so that a failure in between left a row pointing at
  nothing rather than a file nobody could find. With the stream, neither order loses track of one.
- **The orphan clean-up is `cmd/orphans`**, which EventBridge Scheduler runs hourly. It reads every
  user's `ATT#` items with a `Scan`, the one read across partitions, lists the bucket, and keeps
  every rule of Quarkus's `OrphanPlan`, whose tests are ported: an object no item refers to goes
  after seven days; a table without a single file deletes nothing; more than two orphans older
  than an hour raise the alert, a JSON log line with `orphanSweepAlert`; an available attachment
  whose file is missing is logged, never deleted. Expired items still count as referring to their
  files, which are the stream's to delete. The functions, the stream, the schedule and the alarm
  come with #554.
- **A link to open a file is handed out again while half its hour is left**, as before, per Lambda
  instance rather than per backend task; with several instances, a browser sees a few URLs for a
  file at worst. Each link ends with the credentials that signed it, when they end first, and says
  so in its expiry, where the credentials tell their end. **On Lambda they do not:** the
  function's credentials come in environment variables, without an expiry. A link signed shortly
  before they lapse can stop working before the expiry it reports, and since the browser keeps
  it, a preview stays broken for up to half an hour, until the next link. Gunnar accepted that
  (#569) rather than signing anew on every request, which undoes #236, or signing with a role
  assumed for the purpose, which knows its end at the price of a role and an STS call per start.
- **Locally**, `TASKFEST_ATTACHMENTS_BUCKET` names the bucket and `S3_ENDPOINT` points at
  LocalStack, as for the end-to-end stack.

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

Both kinds of item carry `expiresAt`, which will be the table's TTL attribute once #554 turns
TTL on, and the backend checks the times itself as well, since TTL deletes late. A busy session
records its latest request at most every five minutes. A request with no or an ended session
gets a 401: Quarkus answered the website's scripts a 499 instead, and the frontend treats both
alike. A sign-in that fails at the callback (a second tab's, a callback used twice, one
cancelled at the provider) goes back to the app, signed out, rather than to Quarkus's blank 401.
Signing in or out also expires any `q_session` and `q_auth` cookie left from the Quarkus
backend.

## Deleting an account

`DELETE /api/account` (#553) keeps the
[decision](../decisions/domain-and-backend.md#deleting-an-account-leaves-a-record-outside-the-database)
and the Quarkus backend's tests: the record `deleted-accounts/<SHA-256 of the email>` is written
to the attachment bucket first, where a restore of the table cannot take it back, and without a
bucket an account is deleted without one. Two things differ, by Gunnar's decisions on #553:

- **The account is marked, then deleted in batches.** A transaction holds at most 100 items, and
  a user's tasks have no limit, so no single write deletes an account. The first write sets
  `deletedAt` on `META`; then every item of the partition goes, 25 to a `BatchWriteItem`, and
  `META` last. A deletion that cannot be marked takes its record back and answers a 500, as
  before. One that stops after the mark counts as done: the user is told so, and the account's
  next request finishes it before anything else (`api.Settled`, one strongly consistent read of
  `META` per request, `/api/auth/me` included), or the replay does. A request is refused, with a
  401, when that read fails or the deletion cannot be finished: it must never see what is left of
  a deleted account. The partition is read again until nothing is left, for what a request racing
  the deletion wrote, and once more after `META` is gone. Should that last read fail, nothing in
  the table is marked any more; the record in the bucket is, and the replay deletes what is left
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
are ported. EventBridge Scheduler runs it daily (#554). Lambda has no start-up to run it in, so
the restore procedure below runs it once against the restored table **before the API is
switched to it**, and nobody can sign in to a restored account first (Gunnar's decision on #553).

- **An account is deleted again only if it began before its deletion.** `META` carries
  `createdAt`, written with the first id the account counts and kept from then on; the write that
  marks the account deleted again is conditional on it, so an account begun anew since is never
  taken for the restored one. An account without `createdAt` counts as older; there is none, as
  the table starts empty and no user moves over from the Quarkus backend (#557). The Quarkus
  backend's records stay in the bucket and are replayed too; an account begun since stays.
- **What a deletion left without `META` is deleted too**, for the deletion that stopped after
  `META` went: no task, draft or attachment is ever written without `META`. A marked `META` is
  written first, on the condition that there is none, so a sign-up at that moment either keeps
  its account or finds it marked and has it settled like any deletion left half-way. A session
  signed in after the deletion stays; each link carries when its session began. Finishing a
  deletion left half-way spares such a session as well, so signing in again in between does not
  sign out.
- **Each record is handled on its own**, and a run in which an account could not be deleted again
  fails, to be retried by the next. A record younger than five minutes is left to the request that
  wrote it, which may yet take it back and tell the user the deletion failed.
- **A record is pruned once it is older than the oldest point the table could be restored to**,
  by two days, unless its account is still there, and not if it was written again since it was
  read. The two days cover a deletion finished a day after its record, by the next daily run.
  That point is the start of any table's point-in-time recovery window in the region, or the
  oldest backup there, whichever is older: every table and backup counts, not only the table's,
  since a restore goes into a new table and the one it came from stays restorable until it is
  deleted, and a record kept too long costs nothing. When neither exists, or DynamoDB will not
  say, nothing is pruned. Point-in-time recovery is on for prod and off for qa (#553).
- **Its role** (#554) needs `dynamodb:Query`, `GetItem`, `UpdateItem`, `DeleteItem` and
  `BatchWriteItem` on the table, `DescribeContinuousBackups` on every table, `ListTables` and
  `ListBackups`, and on the bucket `s3:ListBucket`, `GetObject` and `DeleteObject` under
  `deleted-accounts/`.

### Restoring the table

A DynamoDB restore always creates a new table; the old one stays until it is deleted. What was
written between the restore point and the switch is lost, as with the database's snapshot
restores ([database.md](database.md)), and files uploaded since are left to the orphan clean-up.
A restore is billed by the size restored, cents for TaskFest. Every step runs with the
administrator's profile.

1. **Restore into a new table**, from point-in-time recovery (prod) or a backup:
   ```bash
   aws dynamodb restore-table-to-point-in-time --source-table-name <table> \
     --target-table-name <table>-restored-<date> --restore-date-time <time>
   aws dynamodb restore-table-from-backup --backup-arn <arn> \
     --target-table-name <table>-restored-<date>
   aws dynamodb wait table-exists --table-name <table>-restored-<date>
   ```
2. **Run the replay against it**, before anything else can reach it:
   ```bash
   cd serverless && AWS_PROFILE=<admin profile> AWS_REGION=eu-central-1 \
     TABLE_NAME=<table>-restored-<date> TASKFEST_ATTACHMENTS_BUCKET=<bucket> go run ./cmd/replay
   ```
   It logs one JSON line, `deletion-replay`, with how many accounts it deleted again; it exits
   non-zero when one could not be, and is then run again.
3. **Switch the functions to the new table.** A restore does not carry the table's TTL, stream or
   point-in-time recovery settings over, so the apply that switches also sets them (#554).

The procedure is tried once in qa, from an on-demand backup, once #554 has built the table.

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

Running it, as an administrator, from the repository root on `main`:

```sh
serverless/build.sh          # the arm64 zip the function is created from
(cd deployment/aws-tofu && TASKFEST_QA_AWS_PROFILE=<admin profile> ./env.sh down qa)
AWS_PROFILE=<admin profile> serverless/spike/measure.sh
```

The apply needs the administrator: qa's lifecycle role, `env.sh`'s default, cannot create IAM
roles, functions or tables. **`down` takes qa down if it is up**; with qa down it applies only
the spike, and the plan it shows says so before anything happens.

`build.sh` uses Go where it is installed and the official Go image through podman or docker
where it is not. `measure.sh` uploads the code, writes twenty tasks for the test account
`taskfest-test-one@example.com`, and prints Lambda's own initialisation, cold and warm times at
128, 256 and 512 MB. The code is in [`serverless/`](../../serverless/), with its conventions in
`serverless/CLAUDE.md`.

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
