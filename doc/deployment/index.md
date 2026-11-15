# Deployment

**Each environment is the Go backend on Lambda with DynamoDB, behind CloudFront with the site**
([serverless.md](serverless.md), #547, #557). The container architecture it replaced, Quarkus on
Fargate with PostgreSQL, went from the code in #559 and from the infrastructure in #557; the
pages that described only it are short notes now, and the tag `pre-serverless` keeps it whole, as
the alternative and the way back ([architecture.md](../architecture.md#two-architectures) compares
the two). This page began as the plan for issue #60, written before anything existed, to settle
the irreversible choices on paper first.

This is also a proof of concept for a more commercial project, which is why it prefers managed
services over the cheapest possible demo.

## The shape

Two environments, `qa` and `prod`, in **one AWS account**, separated by IAM roles and tags
([access.md](access.md) says why). Each holds the same thing:

```
  taskfest.cloud.hilling.de
  taskfest-qa.cloud.hilling.de
            │
            ▼
       CloudFront ──── /*      ──> S3                     (the built SPA)
            │
            └───────── /api/*  ──> HTTP API ──> Lambda ──> DynamoDB
                                               (the Go backend)
```

One distribution for the whole site, with two origins: the site bucket and the Go backend's HTTP
API. That it is one distribution is not a detail — see the next section. The HTTP API's address
is public, so the function refuses every request without a header only CloudFront sends
([serverless.md](serverless.md#the-infrastructure)).

Google is the identity provider in both environments, as it already is in the `prod` profile.
Keycloak stays local-only.


## What changes from the local stack, and the one thing that must not break

Locally, httpd does **two** jobs: it serves the built SPA and it reverse-proxies `/api` to the
backend. `architecture.md` explains why the second one matters — the backend builds its OIDC
`redirect_uri` from the `Host` header, and the session cookie is same-origin.

Moving the SPA to S3 removes httpd. **If CloudFront served only S3, the API would become
cross-origin and sign-in would break** — after deployment, in a way nothing local would catch.

So CloudFront takes both roles:

| Path | Origin | Behaviour |
| --- | --- | --- |
| `/*` | S3 (private, OAC) | cached; 403/404 rewritten to `/index.html` with status 200 |
| `/api/*` | the Go backend's HTTP API | **caching disabled**; `Authorization`, cookies and the query string forwarded, not `Host` |

A CloudFront Function on the default behaviour replaces httpd's `FallbackResource /index.html`,
which is what makes a deep link work — not CloudFront's custom error responses, which would have
rewritten `/api/*` errors too ([deploying.md](deploying.md)). The cache rule on `/api/*` is what
stops a logged-in user's response being served to someone else — the failure mode worth being
most careful about.

The frontend container image is no longer deployed anywhere. It stays in `deployment/docker/`
for local work, which means **the Compose stack is not the shape of production**, and
[local-development](../local-development/index.md) says so: it checks the images, and what only
AWS does is checked in qa.


## In this chapter

| Page | What it covers |
| --- | --- |
| [Names and certificates](names-and-certificates.md) | Hostnames, the certificate, Google's OAuth client, the documentation site's name |
| [Accounts and access](access.md) | One AWS account, and the identities that may change what |
| [The code and what it creates](infrastructure.md) | Where the OpenTofu code is, how it is applied, and what it creates; the Go backend's resources are in serverless.md |
| [Deploying: the Go backend, then the site](deploying.md) | What a release deploys, and the approval gate |
| [Attachment storage](attachments.md) | The bucket, the sweeps that keep it tidy, and what they cost |
| [Observability](observability.md) | Logs, metrics, alarms |
| [Cost](cost.md) | What an environment costs, and what the containers cost |
| [Serverless](serverless.md) | Lambda, Go and DynamoDB: the design, its infrastructure, and its own costs |
| [Open points](open-points.md) | What is deliberately left out, and what is still to be verified |
| [How an environment was torn down](teardown.md), [The database](database.md), [Image scanning](image-scanning.md) | The container architecture's, a note each: what went, and where it is kept |
