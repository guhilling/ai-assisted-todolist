# Deployment

**Status: a plan. Nothing in this document exists yet**, and issue #60 deliberately creates
nothing — the point was to settle the irreversible choices on paper first.

This is also a proof of concept for a more commercial project, which is why it prefers managed
services and a real account boundary over the cheapest possible demo.

## The shape

Two environments, `qa` and `prod`, in **separate AWS accounts**. Each holds the same thing:

```
  todolist.cloud.hilling.de
  todolist-qa.cloud.hilling.de
            │
            ▼
       CloudFront ──── /*      ──> S3                    (the built SPA)
            │
            └───────── /api/*  ──> ALB ──> ECS Fargate ──> RDS PostgreSQL
                                (internal)   (the Quarkus backend)
```

One distribution, two origins. That is not a detail — see the next section.

The load balancer is **internal**: CloudFront reaches it through a [VPC
origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html),
so it has no public address at all. That closes the hole where someone finds the load balancer's
hostname and bypasses CloudFront entirely, and it costs nothing — it replaces the older trick of
having CloudFront send a shared secret header that the load balancer checks.

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
| `/api/*` | ALB | **caching disabled**; `Host`, `Authorization` and cookies forwarded |

A CloudFront Function on the default behaviour replaces httpd's `FallbackResource /index.html`,
which is what makes a deep link work — not CloudFront's custom error responses, which would have
rewritten `/api/*` errors too ([deploying.md](deploying.md)). The cache rule on `/api/*` is what
stops a logged-in user's response being served to someone else — the failure mode worth being
most careful about.

The frontend container image is no longer deployed anywhere. It stays in `deployment/docker/`
for local work, which means **the Compose stack is not the shape of production**, and
[local-development](../local-development/index.md) says so: it checks the images, and what only
AWS does is checked in qa.


## Why there is a load balancer at all

It is the largest fixed item here, so it was challenged on cost twice. It stays, and the
arithmetic is worth writing down because the intuition is wrong.

**The alternative is not free.** An API Gateway HTTP API needs a **VPC link to reach the tasks,
and a VPC link costs $0.01/hour — about $7.20 a month, charged at zero traffic.** Requests are
$1.00 per million on top, which is nothing here. So the comparison is roughly **$16 against
$7.20**: a saving of about **$9 a month per environment**, not the $16 it first looks like.

What that $9 costs is blue/green. ECS shifts traffic between **two target groups**, which is a
load balancer's job; an API Gateway private integration cannot do it. Deployments would become
rolling or stop-and-start — acceptable, since downtime is acceptable here, but the demonstration
goes.

**The real lever is uptime, not the load balancer.** An environment that exists costs about $35
a month before the load balancer; one that has been destroyed costs cents, *including* its load
balancer. Nine dollars a month applies only while an environment is up, and the design already
says QA should not be. Keeping the load balancer therefore costs little in practice and keeps a
capability that is worth demonstrating in a proof of concept.

Also checked and not chosen:

- **A Network Load Balancer**: the same price per hour, and worse — ECS adds a ten-minute delay
  to the blue/green lifecycle stages with an NLB and supports only all-at-once shifting.
- **CloudFront straight to the ECS service**: not possible. VPC origins support load balancers
  and EC2 instances, and a task's IP changes on every deployment.
- **One load balancer shared by both environments**, with host-based rules. It would halve the
  cost *while both are up*, which is the uncommon case, and it cannot be destroyed with either
  environment — so it needs a third OpenTofu stack and couples the two environments together.
  Not worth it for a saving that mostly does not apply.


## In this chapter

| Page | What it covers |
| --- | --- |
| [Names and certificates](names-and-certificates.md) | Hostnames, certificates, Google's OAuth client, the documentation site's name |
| [Accounts and access](access.md) | One AWS account, and the identities that may change what |
| [The code and what it creates](infrastructure.md) | Where the OpenTofu code is, and every resource it creates |
| [Deploying: two paths, chosen by the release](deploying.md) | Blue/green, or downtime for a migration |
| [How an environment is torn down](teardown.md) | The `running` switch, and CloudFront's `/api/*` origin |
| [The database](database.md) | RDS, IAM sign-in, snapshots and restores |
| [Observability](observability.md) | Logs, metrics, alarms |
| [Cost](cost.md) | What an environment costs, measured |
| [Open points](open-points.md) | What is deliberately left out, and what is still to be verified |
