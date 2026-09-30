# Deployment

**Status: a plan. Nothing in this document exists yet**, and issue #60 deliberately creates
nothing — the point was to settle the irreversible choices on paper first.

This is also a proof of concept for a more commercial project, which is why it prefers managed
services and a real account boundary over the cheapest possible demo.

## The shape

Two environments, `qa` and `prod`, in **separate AWS accounts**. Each holds the same thing:

```
            CloudFront ──── /*      ──> S3          (the built SPA)
                 │
                 └───────── /api/*  ──> ALB ──> ECS Fargate ──> RDS PostgreSQL
                                                  (the Quarkus backend)
```

One distribution, two origins. That is not a detail — see the next section.

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

The error-response rule replaces httpd's `FallbackResource /index.html`, which is what makes a
deep link work. The cache rule on `/api/*` is what stops a logged-in user's response being
served to someone else — the failure mode worth being most careful about.

The frontend container image is no longer deployed anywhere. It stays in `docker/` for local
work, which means **the Compose stack is no longer the same shape as production**; the
`local-development.md` claim that it is "the stack for checking the deployment shape" needs
qualifying when this is built.

## Accounts and the IAM boundary

Three identities, and the boundary is an account boundary rather than a policy:

| Account | Holds | Who can change it |
| --- | --- | --- |
| `qa` | the whole QA environment | the QA OIDC role, from GitHub Actions, unattended |
| `prod` | the whole prod environment | the prod OIDC role, from GitHub Actions, **only via a protected environment that requires Gunnar's approval** |
| management | Organizations, consolidated billing, the read-only monitoring identity | nobody, routinely |

**"Prod is never created by an automated agent" is enforced by there being nothing to assume.**
The prod account trusts exactly one principal — the GitHub OIDC provider, restricted to this
repository and to the `prod` environment — and holds no IAM user, no access key and no role a
local session could assume. An agent on a developer machine has no path in. Automation reaches
prod only through a gate a human opens.

Terraform state lives per account, in an S3 bucket in that account with versioning and a DynamoDB
lock table. Cross-account state would put a QA mistake one typo away from prod.

The monitoring identity is a role in the management account with `ReadOnlyAccess` assumable into
both, so dashboards and alarms can see everything and change nothing.

## Resource inventory

Per environment, identical unless noted:

| Resource | Why |
| --- | --- |
| VPC, two public subnets in two AZs | Two AZs because ALB requires it, not for availability |
| **No NAT gateway, no private subnets** | See *Cost* — this is the single biggest saving |
| Security groups | ALB open on 443; ECS open only to the ALB; RDS open only to ECS |
| ALB + ACM certificate | TLS terminates here; the only inbound path to the backend |
| ECS cluster, one Fargate service | The Quarkus backend, 0.5 vCPU / 1 GB |
| ECS task for migrations | Same image, different command; see *The database* |
| RDS PostgreSQL, single-AZ, `db.t4g.micro` | HA is explicitly not required |
| Secrets Manager | The database password and the Google client secret |
| S3 bucket, private | The built SPA; reachable only through CloudFront's origin access control |
| CloudFront distribution | The two origins above |
| CloudWatch log groups, alarms, dashboard | See *Observability* |
| AWS Budgets | See *Cost* |

ECS tasks run in **public subnets with a public IP**, which is what avoids the NAT gateway. They
are not reachable from outside: the security group admits only the ALB. This is a deliberate
demo-scale trade — a commercial deployment would use private subnets and pay for NAT or VPC
endpoints, and the reasoning is in `decisions.md`.

## Deploying: two paths, chosen by the release

Blue/green and "take the downtime" are opposites — blue/green keeps both versions live, which is
exactly the overlap that makes a schema change unsafe. Both are wanted, so the release picks:

**A release with no migration — blue/green.** ECS shifts traffic to a new task set, bakes, and
rolls back by shifting back. Zero downtime, and the rollback is instant because the old task set
is still there. This is the common case.

**A release with a migration — downtime.** Scale the service to zero, snapshot the database, run
Liquibase as a one-off ECS task, deploy the new version, scale back up. Nothing old is running,
so nothing has to be backward-compatible and **expand-and-contract is not needed**.

**The image decides which.** It carries the changelog it expects as a label and a file; the
deployment compares that with the database and takes the corresponding path. Hibernate already
runs `schema-management.strategy=validate`, so a mismatch already fails fast — this makes it
fail before any traffic moves, and say why.

Deployment runs from GitHub Actions, assuming the per-account role through OIDC. No CodePipeline
and no long-lived AWS keys; the prod gate is a protected environment.

The SPA deploys as `aws s3 sync` of a **release artifact**, the same way `openapi.yaml` is already
attached to each release. Rolling the frontend back is re-syncing the previous release, which is
why the build has to be an artifact rather than something rebuilt at deploy time.

## The database

**Migration** is a one-off ECS task running Liquibase, never the application. `migrate-at-start`
stays on for dev and test, where overlap cannot happen, and off everywhere else.

**Rollback of a migration is a snapshot restore**, taken immediately before the migration ran.
Liquibase rollbacks exist and are not exercised here; a restore is the honest answer and it costs
the downtime that this deployment model already accepts.

**`task_state` and `task_importance` are native PostgreSQL enums**, and `ALTER TYPE … ADD VALUE`
cannot be rolled back at all. A release adding an enum value is one-way: it must ship before
anything uses the value, and the only way back is the snapshot. That is the price of the enum
decision in `decisions.md`, and it is the sharpest edge in this plan.

**Idle cost** is handled by destroying the environment, database included, with a final snapshot.
Terraform restores from it on demand. Stopping is not enough: a stopped RDS instance still bills
storage *and AWS restarts it automatically after seven days*.

## Observability

Named, because "best practices are applied" plans nothing:

- **Logs.** The Quarkus JSON log to CloudWatch Logs, one group per environment, 30-day retention
  in QA and 90 in prod. The backend already logs structured output.
- **Metrics.** `/q/metrics` is already exposed and already tested (`MetricsResourceTest`).
  Scraped into CloudWatch by the ECS agent's Prometheus support, so the dashboards use what the
  application already publishes rather than something invented for AWS.
- **Alarms**, each on a condition a person can act on: ALB 5xx rate; ALB target health; ECS
  service running-count below desired; RDS free storage; RDS CPU credit balance — `t4g` instances
  are burstable and exhausting credits looks exactly like a slow application.
- **Traces.** Not in this plan. One service and one database do not repay X-Ray yet; when the
  commercial shape has more than one service, this is where it goes.
- **Alerting to** an SNS topic per environment with Gunnar's email subscribed.

## Cost

**These are estimates from published US East rates in September 2026, not a quote**, and
`eu-central-1` differs. They are here for shape and for setting alert thresholds; the plan does
not pretend to a precision it cannot have without a live account.

One environment, running continuously:

| | Estimate/month | Note |
| --- | --- | --- |
| ALB | ~$16 | Fixed, whether or not anyone uses it |
| Fargate 0.5 vCPU / 1 GB | ~$18 | |
| RDS `db.t4g.micro` single-AZ | ~$12 | Plus ~$2 for 20 GB gp3 |
| S3 + CloudFront | ~$1 | At demo traffic |
| CloudWatch, Secrets Manager | ~$2 | |
| **NAT gateway** | **~$33 — avoided** | Would have been the largest line item |
| **Total** | **~$50** | ~$83 with a NAT gateway |

**Idle, after `terraform destroy`:** a few cents of snapshot and S3 storage. This is the point of
making QA disposable, and it is worth more than any per-resource tuning.

Proposed budget alarms, for sign-off: **QA $25**, **prod $40**, **total $75**, alerting at 80% of
forecast and again at 100% of actual. They are set below the running-continuously estimate on
purpose — an environment left up is exactly what the alarm is for.

## Deliberately not in this plan

- **High availability.** Single AZ for the database, one task for the backend. Explicitly not a
  requirement.
- **Autoscaling.** Demo traffic does not need it, and a fixed task count makes the cost
  predictable.
- **A custom domain.** CloudFront's own domain is enough; adding Route 53 is a small change when
  it is wanted.
- **Multi-region, WAF, private subnets.** Each is a real commercial requirement and none is
  demonstrated by having it here.

## To verify before building

Honest gaps, because a plan that hides them is worse than one that names them:

- **ECS-native blue/green** is used rather than CodeDeploy. It is recent; confirm it covers
  bake time and automatic rollback on alarm before relying on it.
- **`eu-central-1` pricing** — every figure above is a US East rate.
- **CloudFront to a private ALB origin** needs the ALB reachable from CloudFront; confirm whether
  that requires a public ALB with a restricted security group or the VPC origin feature.
- **Google OIDC redirect URIs** must list the CloudFront domain of each environment, which is
  manual configuration in the Google console and cannot be Terraformed.
