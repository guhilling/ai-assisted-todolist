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

The frontend container image is no longer deployed anywhere. It stays in `deployment/docker/`
for local
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
  environment — so it needs a third OpenTofu stack and couples the two environments together.
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

This is manual configuration in the Google console and cannot be automated here. The client id and
secret then go into that environment's Secrets Manager.

## One account, and what that costs in guarantees

QA and prod live in **one AWS account**, separated by IAM roles and resource tags. This reverses
an earlier decision; the reason is that the hosted zone and the certificates live there too, and
splitting the account turned every DNS record and every ACM validation into a cross-account
operation for two hostnames.

**Be clear about what is given up.** With separate accounts, "prod is never created by an
automated agent" was enforceable by there being nothing in the prod account to assume. In one
account it becomes a **policy** guarantee, which is weaker:

## Who may do what

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/identities-dark.svg">
  <img alt="Three identities, in order of how much they may do. A human IAM admin creates the free foundation once: the VPC, subnets, security groups, IAM, the certificate and the DNS records. A role that same human assumes creates and destroys everything that bills: the database, the load balancer and the Fargate service. Below the line, the only unattended identity is the deploy role, assumed from GitHub Actions through OIDC, which may update the service and the site bucket and cannot create, change or delete any infrastructure. Separately, the task roles are what the container runs as rather than an identity anyone assumes, and a read-only user exists for looking at things." src="images/identities-light.svg">
</picture>

The ordering principle is **what a mistake costs**, which is not the same as what a resource
does. The foundation is free and effectively permanent, so it is created once and rarely
touched. The billing resources are the ones torn down and rebuilt whenever an environment is not
being demoed, which makes that a routine operation rather than a one-off. And redeploying the
application happens many times a day, unattended — so it gets the identity that can do the least.

The line in the picture is the claim: **the only identity that runs unattended is the one that
cannot create or destroy anything.** Everything with a bill attached needs a person.

Three technical identities, one job each:

| Identity | May do | Used by |
| --- | --- | --- |
| `gunnar` (IAM admin user) | anything, including the free foundation | a person, with MFA. **Not the account root user**, which has no access keys and is used for nothing |
| `todolist-<env>-lifecycle` (role) | create and destroy what bills: RDS, the load balancer, the Fargate service — and the CloudFront VPC origin that follows the load balancer | a person assuming it, **with MFA** |
| `todolist-qa-deploy` (role) | redeploy the qa application; **no infrastructure** | GitHub Actions, unattended |
| `todolist-prod-deploy` (role) | redeploy the prod application; **no infrastructure** | GitHub Actions, **only from the `prod` environment**, which requires approval |
| `todolist-monitoring` (user) | read-only, everywhere | dashboards and a local CLI profile; can change nothing |

**Why a separate lifecycle role, rather than just using the admin user.** Standing an environment
up and tearing it down again is the routine operation in this project's cost model, not a one-off
— so it is worth having an identity whose blast radius is that operation, and an audit trail that
says which of the two things a given session was doing. It is also the seam at which a "bring qa
up" workflow could later exist.

It is assumed rather than attached, and the trust policy requires MFA — so using it is a
deliberate act with a timestamp, which is most of the point. Sessions last an hour.

**Be honest about what that role is, though.** Creating an RDS instance and a load balancer needs
create *and delete* on those services plus `iam:PassRole` for the task roles, which is close to
administrator for the environment. Scoping it by `env` tag helps and is worth doing, but it is a
**scoping and audit boundary, not a security boundary**: it will not survive a determined misuse
the way the deploy role's policy will. The practical consequence is that it stays human-assumed.
If a qa up/down workflow is ever built, it may use this role because qa is disposable; prod must
not, because "delete the database" is one API call and the snapshot is the only way back.
**The split is by lifecycle stage, not by tag.** Infrastructure — the VPC, the database, the load
balancer, the cluster — is created by a human with their own privileges. The deploy identities
cannot touch any of it. This is stronger than scoping an apply credential by tag, and for a
structural reason: a role that could run `tofu apply` needs create *and delete* on everything the
configuration manages, which is administrator for that environment under a different name. Not
creating such a credential is a guarantee; constraining one is an argument.

A deploy is therefore four things and nothing else: register a task definition, point the service
at it, run the Liquibase task, and sync the frontend artifact into the site bucket.

**The deploy identities are roles assumed through GitHub OIDC, not users with access keys.** A
workflow job trades a signed token describing itself for credentials that expire in minutes, so
no secret is stored in GitHub and there is nothing to rotate. The trust condition names the
repository *and* the GitHub environment, which is what makes the prod approval gate an AWS
refusal rather than only a GitHub courtesy: GitHub will not mint a token claiming
`environment:prod` unless the job declares it, and a protected environment holds the job until
approved.

Four consequences worth being plain about:

- **`ecs:RegisterTaskDefinition` cannot be scoped to a resource.** The call creates one, so there
  is no ARN or tag for a condition to match, and the qa role can register a revision in prod's
  family. It is tolerable because a task definition nobody runs is inert and the calls that would
  run or deploy one are both scoped to this environment — but "denied everything tagged
  `env=prod`" is not literally achievable, and claiming it would be a wall that is not there.
- **`iam:PassRole` is the statement that decides whether the rest is safe.** Running a task means
  handing it a role; granted on `*`, that one permission escalates "redeploy the application" to
  account administrator in a single step. It names the two task roles for this environment and
  conditions on `iam:PassedToService = ecs-tasks.amazonaws.com`.
- **An ARN says which resource, not where it goes.** `ecs:UpdateService` also takes a network
  configuration, so a role scoped to the qa service could still move it into prod's subnets with
  prod's tasks security group — a path to prod's database. Both roles that create or update the
  service are therefore pinned to their own environment's subnets with `ecs:subnet`, which pins
  the VPC too, since a security group must be in its subnet's VPC; the lifecycle role's
  `CreateLoadBalancer` is pinned the same way, to the private subnets, the `alb` group and
  `internal`, and its `CreateDBInstance` and `RestoreDBInstanceFromDBSnapshot` to
  `rds:PubliclyAccessible = false`. **RDS is the gap:** it has no condition key for security
  groups, so the lifecycle role could attach the other environment's database group to its own
  instance. The subnet group is foundation and not the role's to create. That is accepted because
  the role is assumed by a person with MFA.
- **Local credentials are the remaining hole.** An agent running with an administrator profile
  on a developer machine could reach prod, because nothing structural stops it. The mitigation is
  that the profile available locally is itself least-privilege and explicitly denies
  `env=prod`-tagged resources — a discipline, not a wall. Separate accounts were the wall, and
  they were traded for simplicity. Note that this hole is *unrelated* to the deploy roles: they
  cannot reach infrastructure at all, so the risk here is an admin profile, not a leaked
  deploy credential.

State is one S3 bucket with a key per environment. There is no lock table: OpenTofu's S3
backend takes the lock from S3 itself, so the bootstrap is one bucket and nothing else.

## Where the code is

`deployment/aws-tofu/` implements this, and its `README.md` covers running it — bootstrapping
the state bucket, the credential-free checks that CI runs, and the provider lock file.

**The tool is OpenTofu, not Terraform.** The language is identical, the binary is `tofu`, and
two of its features are used deliberately: a backend block may interpolate a variable, so the
environment roots share one `backend.tf`; and the S3 backend takes its lock from S3, so there
is no DynamoDB table. `decisions.md` records the choice.

The layout is one module holding every resource, instantiated by a thin root per environment:

```
modules/environment/     every resource, parameterised
environments/qa/         a root that instantiates the module
environments/prod/       the same root, different values
account/                 the things there is one of per AWS account
```

`account/` holds the GitHub OIDC provider and the monitoring user. Its permissions come from a
`read-only` group: `ReadOnlyAccess`, everything **denied without MFA** except registering a
device, and the state bucket's objects denied even with it. `ReadOnlyAccess` reads every bucket,
so without the MFA rule a leaked access key would have read prod's state. From the CLI the user
therefore needs a session from `aws sts get-session-token --serial-number … --token-code …`; the
bare access key is refused. It exists because those are
singular: instantiating them from a module applied twice would have the two environments fighting
over one provider. It is applied **before** either environment, which look the provider up by URL.

**The two roots are identical apart from `terraform.tfvars`** — the state key is
interpolated from a variable, which Terraform could not do — and
`check-environments-match.py` fails CI when they are not. Making prod a parameter change is the
intent of this plan; that check is what keeps it from decaying into two codebases that drift.
Anything which must differ between environments becomes a module variable instead.

**Cost attribution moves to tags.** With one account there is no per-account bill, so every
resource carries `env=qa` or `env=prod` and the budgets filter on that. This only works if the
tagging is complete: an untagged resource is invisible to both environment budgets and shows up
only in the total.

## Resource inventory

Per environment, identical unless noted:

| Resource | Why |
| --- | --- |
| VPC, two public subnets in two AZs | Two AZs because the load balancer requires it, not for availability |
| **No NAT gateway** | See *Cost* — this is the single biggest saving, and it is why the tasks sit in the public subnets |
| Security groups | ALB open on 443; ECS open only to the ALB; RDS open only to ECS |
| VPC flow logs, to a private S3 bucket | All traffic, kept 30 days; see *Observability*. Not behind the teardown switch, because delivery is charged per GB and a torn-down VPC sends almost nothing |
| **Internal** ALB, two target groups | Blue/green shifts traffic between them; reachable only from CloudFront |
| Two private subnets | For the load balancer only. No NAT gateway: nothing in them makes outbound calls |
| ACM certificate in **us-east-1** | CloudFront accepts certificates from that region only |
| Route 53 alias records | In the same account as everything else; free to query |
| ECS cluster, one Fargate service | The Quarkus backend, 0.5 vCPU / 1 GB |
| ECS cluster, and two one-off tasks | `migrate` (the backend image with `quarkus.init-and-exit`) and `db-bootstrap` (`psql`, once per environment); see *The database* |
| RDS PostgreSQL, single-AZ, `db.t4g.micro` | HA is explicitly not required |
| Secrets Manager | The RDS-managed master password, for bootstrapping and administration only, and the Google client secret. The application has no database password at all |
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

## How an environment is torn down

**Teardown is a parameter, not a `tofu destroy`.** Each environment has a `running` variable; the
resources that cost money — the database, the load balancer, the service — exist only when it is
true. The foundation ignores it and is always there, because it is free and destroying it buys
nothing.

**The CloudFront distribution stays; its `/api/*` origin does not.** A CloudFront VPC origin names
one load balancer ARN and cannot be changed or deleted while a distribution uses it, and the load
balancer is destroyed on every `down`. So `down` drops the distribution's `/api/*` behaviour and
deletes the VPC origin, and `up` creates a new one and adds the behaviour back. Deploying a VPC
origin takes up to 15 minutes and a distribution change several more, so `up` and `down` each take
**roughly 25–35 minutes**. That is the price of a `down` that costs nothing; keeping the load
balancer up instead would have cost about $20 a month while nobody was using the environment.
While down, the distribution still answers, from the site bucket alone.

```sh
deployment/aws-tofu/env.sh up qa       # create what bills
deployment/aws-tofu/env.sh down qa     # destroy it; VPC, subnets and IAM stay
deployment/aws-tofu/env.sh status qa   # what the last apply recorded
```

Three properties of this are deliberate:

- **`running` defaults to `false`.** An environment nobody is demoing is meant to cost nothing, so
  the safe outcome of an apply nobody thought hard about is a foundation and no bill. Bringing an
  environment up is the deliberate act; leaving it up is not.
- **It is never set in `terraform.tfvars`.** Whether an environment happens to be up is a
  transient fact about the world. Committing it would make every teardown a commit and every
  `git pull` a possible surprise — so it is passed on the command line, which is what `env.sh`
  is for.
- **Every billable resource is guarded, and that is checked.** `check-billable-guard.py` fails the
  build on a resource in `billable.tf` without `count = var.running ? 1 : 0`. The failure mode it
  prevents is silent: teardown succeeds, the resource keeps running, and the bill a month later is
  the first evidence.

The alternative was a separate root and state for the billable layer, where `tofu destroy` could
not reach the foundation. It was rejected: the environment roots are already applied, so their
state keys would have had to move, and a parameter is the same mechanism this directory already
uses for the difference between qa and prod.

`env.sh` shows the plan and waits for an answer on every run, and applies the saved plan file
rather than re-evaluating — so what is applied is exactly what was displayed. It defaults to the
lifecycle profile for `up` and `down`, and deliberately not for `status`, since reading what the
last apply recorded needs nothing but the state bucket.

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
Stopping is not enough: a stopped RDS instance still bills storage *and AWS restarts it
automatically after seven days*.

**A down/up cycle keeps the data, not the instance.** `env.sh down` destroys the instance and
leaves a final snapshot named `todolist-<env>-db-final-<timestamp>`; `env.sh up` looks up the
newest one and passes it as `db_restore_snapshot`, so the new instance starts from it. With no
snapshot it starts empty, and it says which on screen. To start empty on purpose, or from an
older snapshot, run the plan by hand with `-var db_restore_snapshot=…` (or `=null`). Snapshots
are never deleted automatically; at this size each is cents a month, and old ones are removed in
the console when wanted.

**The application logs in with IAM, not a password.** The ECS task role
(`todolist-<env>-task`) may `rds-db:connect` as one database user, `todolist_<env>`, and
nothing else. On every new connection `RdsIamCredentialsProvider` signs a token from the task
role's credentials, valid for 15 minutes; RDS checks it against IAM. Nothing secret is configured,
injected or rotated, and the counterpart on EKS would be a service account. The backend switches
it on with `TODO_DATASOURCE_CREDENTIALS_PROVIDER=rds-iam`; without it, as in the Compose stacks,
the password is used as before. Migrations run as the same user.

**The master password is RDS's, and is for bootstrapping only.** `manage_master_user_password`
has RDS generate it, keep it in Secrets Manager and rotate it every seven days, so it is never in
state. Injecting it into the running service was rejected for exactly that rotation: ECS reads a
secret once, at task start, so a long-running task would keep the old password and fail on its
next connection after a rotation.

**Creating the database user is one command, once per environment.** `todolist_<env>` does not
exist until the master user creates it, and nothing outside the VPC can reach the database to do
that, so it is a one-off ECS task:

```sh
./env.sh up qa             # the database, and the two task definitions that point at it
./env.sh db-bootstrap qa   # creates todolist_qa: CREATE ROLE, GRANT rds_iam, schema grants
./env.sh migrate qa        # Liquibase, logged in as todolist_qa with an IAM token
```

`db-bootstrap` runs `psql` from the official PostgreSQL image (pulled from ECR Public's mirror,
which has no Docker Hub rate limit) with the SQL in `modules/environment/db-bootstrap.sql`. It is
the only task that receives the master credentials, and the only one the deploy role cannot run.
It verifies the server with the region's RDS CA bundle, which is committed under
`modules/environment/rds-ca/` and passed in as a variable, because the image does not carry it.
Every statement is idempotent, so running it again — or on a restored database, which already has
the user — changes nothing. It is needed once per environment: every later `up` restores the user
along with the data.

`migrate` is the backend image with `quarkus.init-and-exit`, so Quarkus runs Liquibase and stops
instead of serving. It logs in exactly as the application will, with `verify-full` against the RDS
bundle that `backend/src/main/jib/opt/rds/` puts in the image, so a run that exits 0 proves the
whole path: the user exists, RDS accepts the token, and the certificate checks out. Both commands
print the task's log and exit with its exit code. The tasks run `quay.io/ghilling/todo-backend:latest`
until the deploy change pins a release.

**A restore needs its managed password re-established.** For PostgreSQL, RDS cannot turn on
managed credentials during a snapshot restore — AWS supports that for Oracle only — so a restored
instance comes back with the master password from the time of the snapshot, whose secret was
deleted with the old instance. The AWS provider follows the restore with a `ModifyDBInstance`
that turns managed credentials back on and creates a new secret. That is expected rather than
verified; if the first restore shows no `db_master_secret_arn`, the fallback is
`aws rds modify-db-instance --db-instance-identifier todolist-<env>-db --manage-master-user-password --apply-immediately`.

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
- **Flow logs.** Every connection in and out of the VPC, accepted and rejected, delivered to a
  private S3 bucket per environment and expired after 30 days. S3 rather than CloudWatch Logs:
  half the delivery price and no delivery role. They are read when something needs explaining —
  with Athena or `aws s3 cp` — not watched, and at demo traffic they cost cents a month.
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
| ALB | ~$20 | Fixed, whether or not anyone uses it, while the environment is up. Unavoidable while blue/green is demonstrated. eu-central-1 estimate |
| Fargate 0.5 vCPU / 1 GB | ~$20 | One task, x86. eu-central-1 estimate |
| RDS `db.t4g.micro` single-AZ | ~$13 | Plus ~$3 for 20 GB gp3. Seven days of backups and Performance Insights are within the free allowances. An estimate until qa has run for a month |
| S3 + CloudFront | ~$1 | At demo traffic |
| CloudWatch, Secrets Manager | ~$2 | |
| Route 53 | $0 | The zone already exists; alias queries are not charged |
| **NAT gateway** | **~$33 — avoided** | Would have been the largest line item |
| **Total** | **~$50** | ~$83 with a NAT gateway |

**Both environments up at once** is therefore about $100 a month, which is the number the total
budget alarm is really guarding against.

**Idle, after `tofu destroy`:** a few cents of snapshot and S3 storage. This is the point of
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
- ~~**VPC origins require an internet gateway attached to the VPC**~~ — confirmed by AWS's own
  documentation: the internet gateway is required "to denote that the VPC can receive traffic from
  the internet" and is not used for routing to the origin. The load balancer can sit in a subnet
  with no route out.
- ~~**Whether VPC-origin traffic arrives from the CloudFront prefix list**~~ — yes; AWS documents
  the prefix list and the per-VPC-origin security group as the two ways to admit it. `security.tf`
  says why the prefix list.
- **Tag-filtered budgets** report with a delay and ignore untagged resources; confirm the
  per-environment figures are trustworthy before relying on them instead of a per-account bill.
- **Whether a GitHub environment secret is genuinely unreadable** from a workflow run that has
  not passed the approval gate — the prod key's protection rests on it.
