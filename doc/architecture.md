# Architecture

**TaskFest's backend is Go on AWS Lambda with one DynamoDB table** (#547), behind CloudFront with
the website's files. It replaced a Quarkus backend on Fargate with PostgreSQL, which it was ported
from route by route, so the website and the apps could not tell them apart. Both environments run
on the Go backend: qa since 2026-11-12, prod since its cut-over (#557). The Quarkus backend's code
went in #559, and its infrastructure in #557; the git tag `pre-serverless` keeps both, and is
the way back.
[Two architectures](#two-architectures) compares the two and says why the Go backend is the one
switched to. The [README](../README.md#how-the-application-fits-together) draws the Go backend,
with how it is watched; the containers' drawing is kept in that section, as the reference.

## The pieces

The deployable components, the apps, and one external dependency:

| Component | What it is | Where it lives |
| --- | --- | --- |
| Frontend | React 19 + TypeScript single-page app, served as static files: from S3 through CloudFront in AWS, by Apache httpd locally | `frontend/` |
| Mobile apps | iOS and Android, one Expo (React Native, TypeScript) codebase; released to TestFlight and Play's internal testing, not deployed | `mobile/` |
| Backend | Go on AWS Lambda behind API Gateway's HTTP API, also the OIDC client | `serverless/` |
| Database | One DynamoDB table; DynamoDB Local in the tests and the end-to-end stack | — |
| Identity provider | Google in production; a Keycloak container in development and tests | `keycloak/` |
| Object storage | S3 for task attachments, one bucket per environment, the Go backend's files under `serverless/`; LocalStack in the Go tests, through Testcontainers, and SeaweedFS in the end-to-end stack | — |

## How a request travels

```
browser ──▶ CloudFront ──▶ HTTP API ──▶ Go (Lambda) ──▶ DynamoDB
apps ─────▶ (static files
             from S3)
```

[serverless.md](deployment/serverless.md#the-shape) has the Go backend's side in full. The HTTP
API's address is public, so the function refuses every request without a header only CloudFront
sends ([its infrastructure](deployment/serverless.md#the-infrastructure)).

The browser talks to a single origin. In AWS that is CloudFront: the built assets come from the
environment's site bucket, and everything under `/api/*` goes to the HTTP API and on to the backend
([deployment](deployment/index.md)). In the end-to-end stack httpd plays the same part, serving the
assets on `:8080` and proxying `/api` to the Go server's plain HTTP port, `:8080` in its own
container; in development Vite's dev server does, serving the app on `:5173` and proxying `/api` to
the backend on `:8080`. Either way the SPA makes same-origin requests and needs no CORS handling and
no API base URL. The apps send their `/api` requests to the same address: the qa and prod variants
are each built with their environment's CloudFront as the one base URL, the dev variant with a local
stack ([mobile/development.md](mobile/development.md)).

Both proxies must preserve the original `Host` header — Vite with `changeOrigin: false`,
httpd with `ProxyPreserveHost On`. Where `TASKFEST_PUBLIC_ORIGIN` is not set, as in development, the
backend builds the OIDC `redirect_uri` from that header, so a rewritten host sends the browser to
the wrong port after sign-in.

The one exception is an attachment's content, which never passes through either: the backend
hands out presigned links, and the browser PUTs and GETs the file straight against S3. That
cross-origin request is what the bucket's CORS rule is for.
[decisions/domain-and-backend.md](decisions/domain-and-backend.md) says why.

`FallbackResource /index.html` is what makes a deep link work: any path that is not a real
file is a route the app resolves, not a 404. It is scoped to the document root, and
`ProxyPass` is matched first, so an unknown `/api` path still returns the backend's own 404
rather than the index page.

## Why the backend is a backend-for-frontend

The backend is the OIDC *client*, not a resource server that validates bearer tokens the
frontend obtained for itself. For the browser, the backend runs the code flow
(`serverless/internal/auth`): it performs the authorization code exchange itself and sets the
`taskfest_session` cookie, a random value whose hash keys the session in the table. The frontend
never holds a token, and never sees one.

The mobile app is the exception, and a deliberate one: it cannot carry the website's cookie, so
it sends the ID token its platform's sign-in gave it as a bearer token, and the backend accepts
both ([authentication.md](authentication.md#apps-sign-in-with-a-bearer-id-token)).

The consequences are worth stating, because they explain several shapes elsewhere:

- The frontend's only notion of identity is `GET /api/auth/me`, which returns an email.
- Sign-in is a full-page navigation to `/api/auth/login`, not a fetch — the flow needs
  redirects the browser follows itself.
- `fetch` calls send `X-Requested-With: JavaScript`, for which the backend answers a missing
  session with 401 instead of redirecting a background request, as the Quarkus backend did.

[authentication.md](authentication.md) covers the flow in detail.

## Backend structure

One Go module, `serverless/`: `cmd/` holds the five functions' entry points, `internal/board` the
domain with no AWS package in it, and `internal/store` and `internal/files` DynamoDB and S3.
[serverless.md](deployment/serverless.md#the-code) has the rest, and `serverless/CLAUDE.md` the
conventions.

## API documentation

**The contract is [`doc/api/openapi.json`](api/openapi.json)**, edited by hand since #559, with
descriptions and sample payloads for every route and type. The Go backend and the frontend are
generated from it. Two ways to see it:

- As the committed contract: [`doc/api/`](api/) holds that document, the same as YAML, and one
  standalone JSON Schema per type under `api/schema/`, derived by `python3 doc/api/generate.py`
  and checked by Contract CI.
- Published, with a rendered reference, at
  [taskfest-docs.cloud.hilling.de](https://taskfest-docs.cloud.hilling.de/):
  `/api/main/` tracks the current code, `/api/v1.2.3/` is each release and `/api/latest/` the
  newest final release. Every release also attaches the same documents as downloadable assets.

Until #559 the document was generated from the Quarkus backend's MicroProfile OpenAPI
annotations; the tag `pre-serverless` keeps that, with Swagger UI at `/q/swagger-ui` in dev mode.

The spec is **OpenAPI 3.1**, and that is load-bearing rather than incidental: only from 3.1
onwards are the component schemas JSON Schema documents, which is what lets the frontend
compile them into runtime validators for every response it parses. `generate.py` refuses any
other version. The response schemas mark their fields required, and keep doing so by hand now: a
field the contract left optional would be a field the frontend accepted as missing.

## Two architectures

**The containers' architecture**, as the README drew it until the port: one Quarkus backend on
Fargate behind CloudFront, PostgreSQL on RDS, and the same sign-in and attachment paths as now. It
served prod until the cut-over (#557), and stays drawn here as the alternative the Go backend is
compared with; its code (#559) and its infrastructure (#557) are in the tag `pre-serverless`:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/architecture-containers-dark.svg">
  <img alt="The browser talks only to CloudFront, which serves the app from S3 and passes /api to the Quarkus backend. The backend is the OIDC client: it exchanges the code with the identity provider, Google, itself and returns an encrypted session cookie, so the browser never holds a token. The iOS and Android apps sign in with the identity provider themselves and send their /api requests through CloudFront too, with the ID token as a Bearer token. The database is PostgreSQL on RDS. Files attached to tasks go straight between the browser or the apps and S3 through presigned links the backend signs, so their content never passes through it." src="images/architecture-containers-light.svg">
</picture>

What the drawing did not show, because it was not there: the containers had no alarms of their
own beyond the orphan alert and the up-time reminder ([observability.md](deployment/observability.md)),
and their load balancer, task and database billed by the hour, so an environment had to be taken
down whenever nobody used it. The README's drawing of the Go backend has a whole band for how it is
watched, and nothing in it bills by the hour: an idle month costs its alarms, $0.10 each, and the
shared monitoring VM, about €6, is billed by Hetzner whatever runs.

The two backends answered the same API, from the same contract (`doc/api/openapi.json`), and
shared CloudFront, the site, the attachment bucket and Google sign-in. They differ in what runs and
in what it costs:

| | Containers | Serverless |
| --- | --- | --- |
| Backend | Quarkus on Java 25, in a Fargate task | Go, five Lambda functions on arm64 |
| Reached through | an internal load balancer, a CloudFront VPC origin | API Gateway's HTTP API, with an origin header |
| Data | PostgreSQL on RDS, Liquibase | one DynamoDB table, TTL and a stream |
| Clean-up and deletion replay | inside the backend, while it runs | DynamoDB TTL and a stream function, and the orphan clean-up and replay on a schedule, always |
| Bills | by the hour, about $1.86 a day while up | by the request, about $1 to $1.50 a month always up, eight alarms at $0.10 each included |
| When idle | taken down with `env.sh down`, a daily chore | nothing to take down |
| First request after a pause | none while up; once down, `env.sh up` takes minutes | a cold start, 125–146 ms as measured in qa |
| Deploying | blue/green between two target groups | a new version of each function (#555) |
| Lock-in | moves to any cloud: a container, PostgreSQL, a load balancer | tied to AWS: Lambda, DynamoDB, API Gateway, EventBridge |
| Language, and how it is reviewed | Java, which Gunnar reads and reviews line by line | Go, which Gunnar does not mean to learn: reviewed by its behaviour, the tests and the contract checks |
| Attachment keys | `<key>`, `deleted-accounts/<hash>` | `serverless/attachments/<key>`, `serverless/deleted-accounts/<hash>` |

**Why switch: cost while always up.** The containers bill by the hour whether anyone uses them or
not, almost all of it the load balancer, the task, the database instance and the task's public
address ([cost.md](deployment/cost.md)). So an environment is taken down when idle, which is easy to
forget. The Go backend bills per request: an environment that is always up costs about a dollar a
month, and prod can simply stay up. The price is the tie to AWS, a language Gunnar does not mean
to learn, and DynamoDB's designed-up-front access patterns. The decision,
[The backend moves to Lambda, Go and DynamoDB, after a spike](decisions/deployment-and-aws.md#the-backend-moves-to-lambda-go-and-dynamodb-after-a-spike),
weighs these, and [serverless.md](deployment/serverless.md#what-speaks-against-it) lists the
drawbacks in full.

**Why both stayed for a while.** The Go backend served qa from 2026-11-12, to try it, while the
containers kept serving prod as the way back; prod followed with its cut-over (#557). The Quarkus
code went in #559, and the infrastructure, the load balancer, the Fargate service and the
database, in #557. Each had its own database; in the shared bucket the Go backend keeps to
`serverless/`, so neither backend's clean-up took the other's files for orphans (#578), and the
Quarkus backend's files are still at the top level. The cut-over moved no task or attachment, and
the containers' data is in their final RDS snapshots, kept until Gunnar deletes them. The git tag
`pre-serverless` marks the last `main` before the move, and is the way back.

## Deployment

In the end-to-end stack, httpd serves the built SPA and reverse-proxies `/api`, which is what makes
the application same-origin. In AWS ([deployment](deployment/index.md)) that job is a CloudFront
distribution with S3 for the SPA and the Go backend's HTTP API for `/api` — precisely so the
same-origin arrangement the OIDC flow depends on survives.

## Data

One DynamoDB table holds the tasks, drafts, attachments' records and sign-in sessions, with TTL
and a stream; its items and access patterns are in [serverless.md](deployment/serverless.md#tasks).
There is no schema to migrate: the shape of an item is the Go code's. The Quarkus backend's
PostgreSQL schema, managed by Liquibase with native enum types, went with it (#559).

## Configuration

The Go backend reads its configuration from environment variables only, set by OpenTofu in AWS
and by `docker-compose.e2e.serverless.yml` locally; the secrets (the Google client's) come from
Secrets Manager in AWS, never from the repository. The local stack needs no secret at all, because
it points at a local Keycloak with throwaway credentials.

## Containers and deployment

The frontend image is a two-stage Dockerfile at `frontend/docker/Dockerfile`: build with
Node, serve with httpd. It is built for the end-to-end stack only; in AWS the built files go to S3.
`serverless/Dockerfile` builds the Go backend's image for the same stack; on Lambda the functions
are zips, built by `serverless/build.sh`.

`deployment/` holds everything that deploys the app. `deployment/docker/` has the Compose
stack that wires the pieces together — [local-development.md](local-development/index.md)
describes it — and `deployment/aws-tofu/` has the AWS infrastructure, written in
OpenTofu; [deployment.md](deployment/index.md) describes what it creates. The Go backend is tied
to AWS, and [Two architectures](#two-architectures) says what that trades.
