# Architecture

**TaskFest has two backends**, built to the same API and run side by side in each AWS
environment: the containers' backend, Quarkus on Fargate with PostgreSQL, and the Go backend on
Lambda with DynamoDB, which is being ported (#547). One setting, `api_backend`, says which of them
CloudFront sends `/api/*` to. Once the port is done the website and the apps cannot tell them
apart; until then the Go backend answers 501 to the routes it does not have yet.
[Two architectures](#two-architectures) compares them and says why the Go backend is the one
switched to. Most of this page describes the containers' backend, which is what serves today.

## The pieces

The deployable components, the apps, and one external dependency:

| Component | What it is | Where it lives |
| --- | --- | --- |
| Frontend | React 19 + TypeScript single-page app, served as static files: from S3 through CloudFront in AWS, by Apache httpd locally | `frontend/` |
| Mobile apps | iOS and Android, one Expo (React Native, TypeScript) codebase; released to TestFlight and Play's internal testing, not deployed | `mobile/` |
| Backend, containers | Quarkus 3 REST API on Java 25, also the OIDC client | `backend/` |
| Backend, serverless | Go on AWS Lambda behind API Gateway's HTTP API: the same API, and also the OIDC client | `serverless/` |
| Database | PostgreSQL 18 on RDS, schema managed by Liquibase, for the containers; one DynamoDB table for the Go backend, DynamoDB Local in its tests | — |
| Identity provider | Google in production; a Keycloak container in development and tests | `keycloak/` |
| Object storage | S3 for task attachments, one bucket per environment that both backends share under separate prefixes; LocalStack in development and tests, through Quarkus Dev Services for the containers' backend and Testcontainers for the Go backend's | — |

## How a request travels

```
                            ┌─▶ load balancer ──▶ Quarkus (Fargate) ──▶ PostgreSQL (RDS)
browser ──▶ CloudFront ─────┤   api_backend = "containers"
apps ─────▶ (static files   │
             from S3)       └─▶ HTTP API ──▶ Go (Lambda) ──▶ DynamoDB
                                api_backend = "serverless"
```

Only one of the two lower paths serves `/api/*` at a time. The rest of this section follows the
containers' one; [serverless.md](deployment/serverless.md#the-shape) has the Go backend's. The
HTTP API's address is public, so the function refuses every request without a header only
CloudFront sends ([its infrastructure](deployment/serverless.md#the-infrastructure)).

The browser talks to a single origin. In AWS that is CloudFront: the built assets come from the
environment's site bucket, and everything under `/api/*` goes through a private VPC origin to the
internal load balancer and on to the backend ([deployment](deployment/index.md)). Locally and in
the end-to-end stack httpd plays the same part, serving the assets on `:8080` and proxying `/api`
to the backend's TLS port, `:8443`; the image's `prod` profile serves nothing else (#247);
in development Vite's dev server does, serving the app on `:5173` and proxying `/api` to the
backend on `:8080`. Either way the SPA makes same-origin requests and needs no CORS handling and
no API base URL. The apps send their `/api` requests to the same address: the qa and prod
variants are each built with their environment's CloudFront as the one base URL, the dev variant
with a local stack ([mobile/development.md](mobile/development.md)).

Both proxies must preserve the original `Host` header — Vite with `changeOrigin: false`,
httpd with `ProxyPreserveHost On`. The backend builds the OIDC `redirect_uri` from that
header, so a rewritten host sends the browser to the wrong port after sign-in.

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
frontend obtained for itself. For the browser, Quarkus OIDC runs the code flow: the backend
performs the authorization code exchange and keeps the resulting tokens in the encrypted
`q_session` cookie. The frontend never holds a token, and never sees one.

The mobile app is the exception, and a deliberate one: it cannot carry the website's cookie, so
it sends the ID token its platform's sign-in gave it as a bearer token, and the tenants are
`hybrid` to accept both ([authentication.md](authentication.md#apps-sign-in-with-a-bearer-id-token)).

The consequences are worth stating, because they explain several shapes elsewhere:

- The frontend's only notion of identity is `GET /api/auth/me`, which returns an email.
- Sign-in is a full-page navigation to `/api/auth/login`, not a fetch — the flow needs
  redirects the browser follows itself.
- `fetch` calls send `X-Requested-With: JavaScript`, which the backend pairs with
  `quarkus.oidc.authentication.java-script-auto-redirect=false` to answer 401 instead of
  redirecting a background request.

[authentication.md](authentication.md) covers the flow in detail.

## Backend structure

Three packages, and no more layering than the application earns:

- `api` — JAX-RS resources. Each owns its own request and response records, so the
  persistence entities never reach the wire.
- `model` — Panache active-record entities and the domain enums. See
  [domain-model.md](domain-model.md).
- `service` — the little application logic that is not a resource concern. Currently only
  `UserService`, which owns the create-a-user-on-first-sight rule.

Panache active records mean entities expose public fields and carry their own queries.
That is idiomatic Quarkus rather than an encapsulation lapse: Hibernate rewrites field
access into accessor calls at build time. It is why Checkstyle's `VisibilityModifier`
check is switched off here.

## API documentation

Every JAX-RS resource carries MicroProfile OpenAPI annotations (`@Tag`, `@Operation`,
`@APIResponse`), and the request/response records carry `@Schema` examples, so the
generated spec has real descriptions and sample payloads rather than bare paths. Three ways
to see it:

- Live, including Swagger UI's interactive "Try it out": `./mvnw quarkus:dev`, then
  `http://localhost:8080/q/swagger-ui` (the raw spec is at `/q/openapi`).
- As a build output: every build writes `target/openapi/openapi.{json,yaml}`
  (`quarkus.smallrye-openapi.store-schema-directory`).
- As the committed contract: [`doc/api/`](api/) holds that document plus one standalone JSON
  Schema per type under `api/schema/`, regenerated by `python3 doc/api/generate.py` and
  checked by Backend CI, which fails if the committed copy has drifted from the code.
- Published, with a rendered reference, at
  [taskfest-docs.cloud.hilling.de](https://taskfest-docs.cloud.hilling.de/):
  `/api/main/` tracks the current code, `/api/v1.2.3/` is each release and `/api/latest/` the
  newest final release. Every release also attaches the same documents as downloadable assets.

The spec is **OpenAPI 3.1**, and that is load-bearing rather than incidental: only from 3.1
onwards are the component schemas JSON Schema documents, which is what lets the frontend
compile them into runtime validators for every response it parses. `OpenApiContractTest`
asserts the version, and asserts that the response records mark their fields required — a
field the spec left optional would be a field the frontend accepted as missing.

## Two architectures

The two backends answer the same API, generated from the same contract (`doc/api/openapi.json`),
and share CloudFront, the site, the attachment bucket and Google sign-in. They differ in what runs
and in what it costs:

| | Containers | Serverless |
| --- | --- | --- |
| Backend | Quarkus on Java 25, in a Fargate task | Go, four Lambda functions on arm64 |
| Reached through | an internal load balancer, a CloudFront VPC origin | API Gateway's HTTP API, with an origin header |
| Data | PostgreSQL on RDS, Liquibase | one DynamoDB table, TTL and a stream |
| Clean-up and deletion replay | inside the backend, while it runs | DynamoDB TTL and a stream function, and the orphan clean-up and replay on a schedule, always |
| Bills | by the hour, about $1.86 a day while up | by the request, about $1 to $1.50 a month always up, seven alarms at $0.10 each included |
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

**Why keep both for now.** Until the Go backend has every route and has served qa for a while, the
containers are what serves, and the way back if the Go backend falls short. Each has its own
database; in the shared bucket the Go backend keeps to `serverless/`, so neither backend's
clean-up takes the other's files for orphans, and IAM keeps each out of the other's part (#578).
The cut-over (#557) switches `api_backend`; the git tag `pre-serverless` marks the last `main`
before the move.

## Deployment

Locally and in the end-to-end stack, httpd serves the built SPA and reverse-proxies `/api`, which
is what makes the application same-origin. In AWS ([deployment](deployment/index.md)) that job is a
CloudFront distribution with S3 for the SPA and, for `/api`, the load balancer or the Go backend's
HTTP API, as `api_backend` says — precisely so the same-origin arrangement the OIDC flow depends on
survives, whichever backend serves.

## Schema management

Liquibase owns the schema; Hibernate is set to `validate` and never generates DDL. Every
schema change is its own changelog under `backend/src/main/resources/db/changes/`, checked
in with the code that needs it, and applied at startup by
`quarkus.liquibase.migrate-at-start`. The application therefore fails fast on a schema it
does not recognise rather than quietly adapting to it.

`001-baseline.xml` is the whole schema as one changelog. It replaced the three that had built
it up, because no database they applied to outlived them and reading three files to learn the
shape of two tables was the only thing that history added.

**`state` and `importance` are native PostgreSQL enum types**, `task_state` and
`task_importance`, not `VARCHAR`. The database rejects a value the application does not define
rather than storing it for someone else to find. The entity says so with
`@JdbcTypeCode(SqlTypes.NAMED_ENUM)` and a `columnDefinition` naming the type; without the
first, the driver sends a `varchar` parameter that PostgreSQL will not assign to an enum
column, and without the second, Hibernate looks for a type named after the Java class.

The cost is that the type and the Java enum are declared in two places. `TaskEnumColumnTest`
is what keeps them honest: it asserts that both columns really are enum types and that their
labels match the Java constants exactly, so adding a value to one and not the other fails the
build rather than the first request that uses it. Adding a value later is
`ALTER TYPE ... ADD VALUE`, which PostgreSQL allows; renaming or removing one needs a new type
and a column rewrite.

## Configuration

One `application.properties` with profile prefixes (`%prod.`, `%dev,test.`, `%qa.`) rather
than separate files per environment, so the differences between environments are visible
side by side. Secrets are never checked in: production reads Google credentials from
environment variables, and `.env.example` documents which ones. The dev and test profiles
need no secrets at all, because they point at a local Keycloak with throwaway credentials.

Dev and test deliberately leave the datasource URL and the OIDC issuer *unset*, which is
what makes Quarkus Dev Services start PostgreSQL and Keycloak automatically.

## Containers and deployment

The backend image is built by **Jib** rather than from a Dockerfile — `./mvnw package
-Dquarkus.container-image.build=true` — and published, like the frontend's, for `amd64` and `arm64`
(#249), on an explicitly pinned base of our own, `jre-runtime`
(Temurin's Java 25 JRE on UBI micro, `deployment/jre-runtime/`). The pin matters: Jib's default
base ships JDK 21 and cannot load this code's class files. There are no Dockerfiles under
`backend/` at all: the four Quarkus generated were unused, two of them JDK 17 based, and all
four were deleted.

The frontend image is a two-stage Dockerfile at `frontend/docker/Dockerfile`: build with
Node, serve with httpd.

`deployment/` holds everything that deploys the app. `deployment/docker/` has the Compose
stacks that wire the pieces together — [local-development.md](local-development/index.md)
describes both — and `deployment/aws-tofu/` has the AWS infrastructure, written in
OpenTofu; [deployment.md](deployment/index.md) describes what it creates. Nothing about the
containers' backend assumes AWS: it is a stateless container reading its configuration from the
environment, plus a PostgreSQL it connects to by URL. The Go backend, in `serverless/`, is the
opposite, and [Two architectures](#two-architectures) says what that trades.
