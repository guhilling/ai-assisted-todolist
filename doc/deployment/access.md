# Accounts and access

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
  <source media="(prefers-color-scheme: dark)" srcset="../images/identities-dark.svg">
  <img alt="Three identities, in order of how much they may do. A human IAM admin creates the free foundation once: the VPC, subnets, security groups, IAM, the certificate and the DNS records. A role that same human assumes creates and destroys everything that bills: the database, the load balancer and the Fargate service. Below the line, the only unattended identity is the deploy role, assumed from GitHub Actions through OIDC, which may update the service and the site bucket and cannot create, change or delete any infrastructure. Separately, the task roles are what the container runs as rather than an identity anyone assumes, and a read-only user exists for looking at things." src="../images/identities-light.svg">
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

