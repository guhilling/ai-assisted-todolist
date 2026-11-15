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
  <img alt="Two identities, in order of how much they may do. A human IAM admin creates and changes everything by an apply: the table, the buckets, the functions, the HTTP API, the distribution, IAM, the certificate and the DNS records. Below the line, the only unattended identity is the deploy role, assumed from GitHub Actions through OIDC, which may deploy the Go backend's code and the site bucket and cannot create, change or delete any infrastructure. Separately, the function roles are what the Go backend's functions run as rather than an identity anyone assumes. A read-only user exists for looking at things." src="../images/identities-light.svg">
</picture>

The ordering principle is **what a mistake costs**, which is not the same as what a resource
does. Changing infrastructure is rare and done by a person; redeploying the application happens
many times a day, unattended — so it gets the identity that can do the least.

The line in the picture is the claim: **the only identity that runs unattended is the one that
cannot create or destroy anything.** Every change to infrastructure needs a person.

The identities, one job each:

| Identity | May do | Used by |
| --- | --- | --- |
| `gunnar` (IAM admin user) | anything: every apply, through `env.sh` ([infrastructure.md](infrastructure.md#applying)) | a person, with MFA. **Not the account root user**, which has no access keys and is used for nothing |
| `taskfest-qa-deploy` (role) | redeploy the qa application; **no infrastructure** | GitHub Actions, unattended |
| `taskfest-prod-deploy` (role) | redeploy the prod application; **no infrastructure** | GitHub Actions, **only from the `prod` environment**, which requires approval |
| `taskfest-qa-live-test` (role) | set the qa test accounts' passwords for a live-test run | GitHub Actions, only from the `qa-live-test` environment |
| `taskfest-monitoring` (user) | read-only, everywhere but the state, people's files and secrets (#430) | dashboards and a local CLI profile; can change nothing |

Until #557 there was a fourth kind, `taskfest-<env>-lifecycle`, a role a person assumed with MFA to
create and destroy what billed by the hour: the database, the load balancer and the Fargate
service. Nothing bills by the hour any more, so it went with them; the tag `pre-serverless` keeps
it.

**The split is by lifecycle stage, not by tag.** Infrastructure — the table, the buckets, the
functions, the distribution, every role — is created by a human with their own privileges. The
deploy identities cannot touch any of it. This is stronger than scoping an apply credential by
tag, and for a structural reason: a role that could run `tofu apply` needs create *and delete* on
everything the configuration manages, which is administrator for that environment under a
different name. Not creating such a credential is a guarantee; constraining one is an argument.

A deploy is therefore two things and nothing else: upload a release's code to the Go backend's
functions and move their alias `live` ([serverless.md](serverless.md#deploying-a-release)), and
sync the frontend artifact into the site bucket.

**The deploy identities are roles assumed through GitHub OIDC, not users with access keys.** A
workflow job trades a signed token describing itself for credentials that expire in minutes, so
no secret is stored in GitHub and there is nothing to rotate. The trust condition names the
repository *and* the GitHub environment, which is what makes the prod approval gate an AWS
refusal rather than only a GitHub courtesy: GitHub will not mint a token claiming
`environment:prod` unless the job declares it, and a protected environment holds the job until
approved.

Two consequences worth being plain about:

- **Every grant names this environment's resources by ARN.** The functions are named
  `taskfest-<env>-<command>`, the site bucket `taskfest-<env>-site`, so the qa role cannot touch
  prod's. It passes no role and runs nothing but the functions it deploys. The container
  architecture's gaps — `ecs:RegisterTaskDefinition` that could not be scoped, `ecs:RunTask` that
  could not be pinned to a network, `iam:PassRole` for the task roles — went with it (#557).
- **Local credentials are the remaining hole.** An agent running with an administrator profile
  on a developer machine could reach prod, because nothing structural stops it. The mitigation is
  that the profile available locally is itself least-privilege and explicitly denies
  `env=prod`-tagged resources — a discipline, not a wall. Separate accounts were the wall, and
  they were traded for simplicity. Note that this hole is *unrelated* to the deploy roles: they
  cannot reach infrastructure at all, so the risk here is an admin profile, not a leaked
  deploy credential.

State is one S3 bucket with a key per environment. There is no lock table: OpenTofu's S3
backend takes the lock from S3 itself, so the bootstrap is one bucket and nothing else.

