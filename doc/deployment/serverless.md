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

## The code

[`serverless/`](../../serverless/) is one Go module; its conventions are in
`serverless/CLAUDE.md`.

- **`cmd/api`** is the backend: one binary that serves API Gateway's events on Lambda and plain
  HTTP anywhere else, so that local development and the end-to-end tests can run the code Lambda
  runs. `internal/lambdahttp` turns one into the other. The end-to-end suite still builds the
  Quarkus backend until #556 moves it.
- **`internal/api`** holds the routes and wire types, generated from `doc/api/openapi.json`, and
  the handlers. A route not ported yet answers 501. One test checks that every route of the
  contract is served; the responses checked against the contract are the board's so far, and
  each ported route brings its own check.
- **`internal/board`** is the domain, with no AWS package in it; **`internal/store`** is DynamoDB.

Locally, with DynamoDB Local on port 8000 and a table created in it:

```sh
cd serverless
TABLE_NAME=<table> DYNAMODB_ENDPOINT=http://localhost:8000 AWS_REGION=eu-central-1 \
  AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local go run ./cmd/api
```

Until sign-in is ported (#549) nobody is signed in there, so the board answers 401; on Lambda the
caller is read from the claims API Gateway's JWT authorizer passes on, as in the spike.

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
