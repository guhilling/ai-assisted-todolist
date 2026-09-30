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

The error-response rule replaces httpd's `FallbackResource /index.html`, which is what makes a
deep link work. The cache rule on `/api/*` is what stops a logged-in user's response being
served to someone else — the failure mode worth being most careful about.

The frontend container image is no longer deployed anywhere. It stays in `docker/` for local
work, which means **the Compose stack is no longer the same shape as production**; the
`local-development.md` claim that it is "the stack for checking the deployment shape" needs
qualifying when this is built.

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
  environment — so it needs a third Terraform stack and couples the two environments together.
  Not worth it for a saving that mostly does not apply.

## Names and certificates

The zone `cloud.hilling.de` already exists in Route 53.

| Environment | Host |
| --- | --- |
| QA | `todolist-qa.cloud.hilling.de` |
| Prod | `todolist.cloud.hilling.de` |

Each is an A and AAAA alias record pointing at that environment's CloudFront distribution;
alias records to CloudFront are not charged.

**Two things that catch people, both worth knowing before building:**

- **The certificate must be in `us-east-1`.** CloudFront only accepts ACM certificates from that
  region, whatever region everything else lives in. The backend's own certificate, if the
  internal load balancer ever needs one, is separate and regional.
- **The zone and the environments are in the same account**, which is one of the reasons that
  decision was reverted — no cross-account role, no subdomain delegation, and ACM's DNS
  validation writes its record directly.

**Alias records, not `CNAME`s**, and the cost difference is real though small here. Route 53 does
not charge for queries to an alias record that points at an AWS resource; a `CNAME` is a standard
record at **$0.40 per million queries**, and a `CNAME` pointing at another name in the same zone
is billed as **two** queries because the resolver has to ask twice. At demo traffic that is
fractions of a cent either way — but an alias is free, avoids the second lookup, and is the only
one of the two that would work at a zone apex. There is no case for the `CNAME`.

### The Google OIDC configuration

Fixed hostnames make these knowable now, so they can be set up once the environments exist.
The backend uses `quarkus.oidc.authentication.redirect-path=/api/auth/callback`, and `/api/*`
routes through the same distribution, so the authorised redirect URIs are:

- `https://todolist-qa.cloud.hilling.de/api/auth/callback`
- `https://todolist.cloud.hilling.de/api/auth/callback`

This is manual configuration in the Google console and cannot be Terraformed. The client id and
secret then go into that environment's Secrets Manager.

## One account, and what that costs in guarantees

QA and prod live in **one AWS account**, separated by IAM roles and resource tags. This reverses
an earlier decision; the reason is that the hosted zone and the certificates live there too, and
splitting the account turned every DNS record and every ACM validation into a cross-account
operation for two hostnames.

**Be clear about what is given up.** With separate accounts, "prod is never created by an
automated agent" was enforceable by there being nothing in the prod account to assume. In one
account it becomes a **policy** guarantee, which is weaker:

Three IAM **users** — technical identities, one job each:

| User | May touch | Used by |
| --- | --- | --- |
| `todolist-qa-deploy` | resources tagged `env=qa`; denied everything tagged `env=prod` | GitHub Actions, unattended |
| `todolist-prod-deploy` | resources tagged `env=prod` | GitHub Actions, **only from the `prod` environment**, which requires approval |
| `todolist-monitoring` | read-only, everywhere | dashboards and alarms; can change nothing |

Two consequences worth being plain about:

- **These users have long-lived access keys**, held as GitHub Actions secrets, prod's scoped to
  the protected environment. That is a real difference from a role assumed through OIDC, which
  issues short-lived credentials and stores nothing. The mitigations are the usual ones — least
  privilege by tag, scheduled rotation, and an alarm on either key being used from outside
  Actions — and moving to OIDC later would change nothing else in this plan.
- **Local credentials are the remaining hole.** An agent running with an administrator profile
  on a developer machine could reach prod, because nothing structural stops it. The mitigation is
  that the profile available locally is itself least-privilege and explicitly denies
  `env=prod`-tagged resources — a discipline, not a wall. Separate accounts were the wall, and
  they were traded for simplicity.

Terraform state is one bucket with a key per environment, and a lock table.

**Cost attribution moves to tags.** With one account there is no per-account bill, so every
resource carries `env=qa` or `env=prod` and the budgets filter on that. This only works if the
tagging is complete: an untagged resource is invisible to both environment budgets and shows up
only in the total.

## Resource inventory

Per environment, identical unless noted:

| Resource | Why |
| --- | --- |
| VPC, two public subnets in two AZs | Two AZs because the load balancer requires it, not for availability |
| **No NAT gateway, no private subnets** | See *Cost* — this is the single biggest saving |
| Security groups | ALB open on 443; ECS open only to the ALB; RDS open only to ECS |
| **Internal** ALB, two target groups | Blue/green shifts traffic between them; reachable only from CloudFront |
| Two private subnets | For the load balancer only. No NAT gateway: nothing in them makes outbound calls |
| ACM certificate in **us-east-1** | CloudFront accepts certificates from that region only |
| Route 53 alias records | In the same account as everything else; free to query |
| ECS cluster, one Fargate service | The Quarkus backend, 0.5 vCPU / 1 GB |
| ECS task for migrations | Same image, different command; see *The database* |
| RDS PostgreSQL, single-AZ, `db.t4g.micro` | HA is explicitly not required |
| Secrets Manager | The database password and the Google client secret |
| Three IAM users and their policies | The technical identities above, scoped by tag |
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

Deployment runs from GitHub Actions as the environment's technical user. No CodePipeline; the
prod gate is a protected environment, which is also what keeps the prod key unreadable from an
unapproved run.

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
| ALB | ~$16 | Fixed, whether or not anyone uses it. Unavoidable while blue/green is demonstrated |
| Fargate 0.5 vCPU / 1 GB | ~$18 | |
| RDS `db.t4g.micro` single-AZ | ~$12 | Plus ~$2 for 20 GB gp3 |
| S3 + CloudFront | ~$1 | At demo traffic |
| CloudWatch, Secrets Manager | ~$2 | |
| Route 53 | $0 | The zone already exists; alias queries are not charged |
| **NAT gateway** | **~$33 — avoided** | Would have been the largest line item |
| **Total** | **~$50** | ~$83 with a NAT gateway |

**Both environments up at once** is therefore about $100 a month, which is the number the total
budget alarm is really guarding against.

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
- **Multi-region, WAF, private subnets.** Each is a real commercial requirement and none is
  demonstrated by having it here.

## To verify before building

Honest gaps, because a plan that hides them is worse than one that names them:

- **ECS-native blue/green** is used rather than CodeDeploy, and it is confirmed to need two
  target groups on one load balancer. What is not yet confirmed is its bake-time and
  automatic-rollback-on-alarm behaviour.
- **`eu-central-1` pricing** — every figure above is a US East rate.
- **VPC origins require an internet gateway attached to the VPC** — present here as a marker
  that the VPC may receive CloudFront traffic, not as a route. Confirm it behaves that way with
  the load balancer in a private subnet and the tasks in public ones.
- **Tag-filtered budgets** report with a delay and ignore untagged resources; confirm the
  per-environment figures are trustworthy before relying on them instead of a per-account bill.
- **Whether a GitHub environment secret is genuinely unreadable** from a workflow run that has
  not passed the approval gate — the prod key's protection rests on it.
