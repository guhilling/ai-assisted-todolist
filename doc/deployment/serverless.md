# Serverless: Lambda, Go and DynamoDB

**Status: decided, not built.** Gunnar chose this direction on 2026-11-09 (#535), behind a spike
that measures it first. Everything else in these deployment chapters still describes what runs
today: the container architecture, Quarkus on Fargate behind a load balancer with PostgreSQL on
RDS. That description stays when the port is done, as the alternative to this one, and the git
tag `pre-serverless` marks the last `main` before the move, for a rollback in the worst case.

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
  key says what the item is: `META` for the user, `TASK#<id>`, `DRAFT#<id>`, `ATT#<id>`. A
  board is one `Query` on `TASK#`, and a draft, which is no task yet, never matches it. Task stays the aggregate the [domain model](../domain-model.md) says it is.
- **The per-user limits** (five drafts, five attachments, two per task) become counters on the
  user's `META` item, changed in the same conditional transaction as the item they count. That
  replaces the row lock (`User.lockRow`).
- **The sweeps** become DynamoDB TTL on drafts and detached attachments, with a stream handler
  that deletes their files from S3. The orphan sweep and the deletion replay run from
  EventBridge Scheduler.
- **The API contract stays.** `doc/api/openapi.json` is what the Go code is generated from and
  tested against, so the website and the apps do not notice the switch.

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
  the fallback, in the language Gunnar knows.
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
