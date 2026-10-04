# AWS infrastructure

The AWS environments, `qa` and `prod`, written in **OpenTofu**.
`doc/deployment/` is the plan this implements and holds the reasoning;
`doc/decisions/deployment-and-aws.md` records why OpenTofu and not Terraform. This file is how to run it.

## OpenTofu, not Terraform

The binary is `tofu`. The language, the provider protocol and the file names are Terraform's, so
`main.tf` and `terraform.tfvars` are still called that and every provider example still applies —
substitute `tofu` for `terraform` on the command line and nothing else changes.

Two OpenTofu features are used deliberately, and the configuration will **not** work on Terraform
because of them:

- **A backend block interpolates a variable** (1.8), so `backend.tf` is identical in both
  environment roots instead of differing in its state key.
- **The S3 backend locks using S3** (1.10), so there is no DynamoDB table.

Install it with `brew install opentofu`. CI pins 1.12.6; keep the local version in step, because
`tofu fmt` output has changed between minor releases before now.

## The shape, and the one rule that keeps it

```
modules/environment/     every resource, parameterised
environments/qa/         a root that instantiates the module
environments/prod/       the same root, different values
account/                 the things there is one of per AWS account
```

`account/` is a root with resources written directly in it, which the environment roots are
forbidden from having. The rule exists to stop qa and prod drifting, and does not apply where
there is exactly one of the thing: a module instantiated twice would have both environments
fighting over one GitHub OIDC provider. **Apply `account/` first** — the environments look the
OIDC provider up by URL and cannot plan until it exists.

The environment roots are **byte-identical apart from `terraform.tfvars`**, and
`check-environments-match.py` fails the build when they are not. That is the whole design: prod is
a parameter change, not a second codebase. Anything that has to differ between the environments
has to become a module variable, which is exactly the pressure the check exists to apply.

So: **never add a resource to an environment root.** Resources go in the module.

Today the entire difference is:

| | qa | prod |
| --- | --- | --- |
| `environment` | `qa` | `prod` |
| `vpc_cidr` | `10.20.0.0/16` | `10.30.0.0/16` |

## What exists so far

The network, the security groups and the flow logs — the layer everything else attaches to.

| File | What it holds |
| --- | --- |
| `network.tf` | VPC, two public subnets, two private subnets, internet gateway, route tables |
| `security.tf` | The four-hop chain: CloudFront → load balancer → task → database |
| `flow-logs.tf` | VPC flow logs, all traffic, into a private bucket of the environment's own, kept 30 days |
| `database.tf` | The database's subnet group, and the ECS task role with its IAM login to the database |
| `ecs.tf` | The ECS cluster, the task log group, the role ECS uses to start a task, and the one it shifts blue/green traffic with |
| `edge.tf` | The hostname, both certificates, the site bucket, and the CloudFront distribution in front of everything |
| `billable.tf` | What costs money while it exists, or points at what does: the RDS instance, the internal load balancer with its blue and green target groups, the backend service, the CloudFront VPC origin, and the task definitions |

Three properties of the network are deliberate and will look wrong without the reason:

- **There is no NAT gateway.** At about $33/month per environment it would have cost more than
  the database. The ECS tasks therefore run in the *public* subnets with public IPs, and what
  keeps them private is the security group in `security.tf`, which lets nothing but the load
  balancer open a connection to them.
- **The private subnets have a route table with no routes.** That is what "no NAT" looks like
  written down. They hold the internal load balancer and the database.
- **Two availability zones because the load balancer requires two**, not for high availability.
  A single task in one AZ is not highly available, and the plan does not claim it is.

Still to come, each as its own change: the SPA in the site bucket and Google sign-in; the deploy
workflow; the CloudWatch alarms, budgets and IAM users.

## Bootstrapping the state bucket, once

OpenTofu cannot create the backend it is about to use, so the bucket is made by hand, once, before
the first `init`. Both environments share it; their state files are separated by key, not by
bucket. There is no lock table — the S3 backend takes its lock from the bucket.

```sh
aws s3api create-bucket \
  --bucket todolist-tofu-state \
  --region eu-central-1 \
  --create-bucket-configuration LocationConstraint=eu-central-1

# Versioning is the undo for a corrupted or truncated state file. It is not optional.
aws s3api put-bucket-versioning \
  --bucket todolist-tofu-state \
  --versioning-configuration Status=Enabled

aws s3api put-public-access-block \
  --bucket todolist-tofu-state \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

## Running it

Once, first:

```sh
cd deployment/aws-tofu/account
tofu init && tofu apply
```

Then an environment:

```sh
cd deployment/aws-tofu/environments/qa
tofu init
tofu plan
tofu apply
```

`prod` is the same commands in the other directory. The state key differs, so the two never see
each other.

**A plain `tofu apply` while an environment is up takes it down.** `running` defaults to `false`
and is never in `terraform.tfvars`, so an administrator's apply of foundation changes plans to
destroy everything billable unless it says otherwise. While the environment is up — or half up,
after an `env.sh up` that failed — apply with what `env.sh up` would pass:
`-var running=true -var db_restore_snapshot=<the newest final snapshot>`. `running=true` alone
creates an *empty* database if there is none. **Not `-target=…`**: it pulls in everything the
target depends on, and the lifecycle policy depends on the distribution, which depends on the VPC
origin — so a targeted apply of "just the policy" planned the teardown all the same. When in
doubt, `./env.sh status <env>` first.

**IAM changes take a while to reach every region.** AWS applies a policy change *eventually*: in
one region it is in effect at once, in another it can take seconds to minutes. It happened
here: an admin apply granted the lifecycle role `cloudfront:Describe*` and
`secretsmanager:GetResourcePolicy`, and the very next `env.sh up` passed the CloudFront call —
evaluated in us-east-1 — and was refused the Secrets Manager one in eu-central-1, with an
`AccessDenied` naming exactly the action just granted. So:

- After an apply that changes the lifecycle role, the deploy role or the task roles, **wait a
  minute** before using them.
- An `AccessDenied` for an action the policy **does** grant is this, not a missing permission.
  Tell the two apart with the simulator, which evaluates the live policy:
  `aws iam simulate-principal-policy --policy-source-arn <role arn> --action-names <action>
  --resource-arns <resource arn>`. `allowed` means wait and run again; `implicitDeny` means the
  policy really lacks it. `env.sh` prints this hint when a plan fails with `AccessDenied`.

**Apply is a human's job.** There is deliberately no credential that can run it — see *Who may
deploy* below — so this is run from a profile with the privileges to create infrastructure.

## Bringing an environment up and down

Teardown is a **parameter**, not a `tofu destroy`. The resources that cost money exist only when
`running` is true; the foundation ignores it and is always there.

```sh
./env.sh up qa       # create the database, load balancer and service; ~25-35 minutes
./env.sh down qa     # destroy them; VPC, subnets, security groups and IAM stay
./env.sh status qa   # what the last apply recorded
./env.sh db-bootstrap qa   # once per environment: create the database user
./env.sh migrate qa        # run the Liquibase migrations
```

`env.sh` shows the plan and waits for an answer on every run, and applies the **saved plan file**
rather than re-evaluating, so what is applied is exactly what was displayed. `--yes` skips the
prompt, for a workflow. It defaults to the lifecycle profile for `up` and `down`, and deliberately
not for `status` — reading what the last apply recorded needs nothing but the state bucket.

**`up` restores the database from the newest final snapshot** of that environment, which `down`
leaves behind, so the data survives a cycle even though the instance does not. It says on screen
which snapshot, or that there is none and the database starts empty. `doc/deployment/database.md` covers starting empty on purpose and the one-time step after the first restore.

`running` defaults to **false**, so a plain `tofu apply` creates a foundation and no bill.
Bringing an environment up is the deliberate act. It is never set in `terraform.tfvars`: whether
an environment happens to be up is a transient fact about the world, and committing it would make
every teardown a commit.

**A new resource that costs money goes in `modules/environment/billable.tf` and carries
`count = var.running ? 1 : 0`.** This is checked, not remembered — `check-billable-guard.py` fails
the build otherwise, because the failure mode is silent: the teardown succeeds, that one resource
keeps running, and the bill is the first evidence.

## Who may create and destroy what bills

Each environment gets `todolist-<env>-lifecycle`, a role a **person** assumes with MFA. It may
create and delete the database, the load balancer and the running service, and — because
CloudFront's `/api/*` origin has to follow the load balancer — create and delete VPC origins and
update this environment's one distribution. Nothing else: no `ec2:Create*`, no `iam:CreateRole`,
no S3, no Route 53, and it cannot create or delete a distribution. The foundation is applied by an
administrator and this role cannot touch it.

To use it, first exchange your long-term key for an MFA session, then assume:

```sh
aws sts get-session-token \
  --serial-number arn:aws:iam::<account>:mfa/<user> \
  --token-code <from your authenticator>
```

Export those three values, then point OpenTofu at the role by adding to the provider block or,
more simply, by setting up a named profile:

```ini
# ~/.aws/config
[profile todolist-qa-lifecycle]
role_arn       = arn:aws:iam::<account-id>:role/todolist-qa-lifecycle
source_profile = default
mfa_serial     = arn:aws:iam::<account-id>:mfa/<your-iam-user>
region         = eu-central-1
```

Where each value comes from:

| Field | Value |
| --- | --- |
| `role_arn` | `arn:aws:iam::<account-id>:role/todolist-<env>-lifecycle`. The name is the environment prefix plus `-lifecycle`, so it is predictable; `tofu -chdir=environments/qa output -raw lifecycle_role_arn` prints it once applied |
| `source_profile` | The profile holding your own long-term key — the one `aws sts get-caller-identity` answers as today. Usually `default` |
| `mfa_serial` | `aws iam list-mfa-devices --query 'MFADevices[0].SerialNumber' --output text` |
| `region` | The `region` in that environment's `terraform.tfvars` |

**OpenTofu cannot prompt for the MFA code**, and fails with *"assume role with MFA enabled, but
AssumeRoleTokenProvider session option not set"* if it is handed the profile name. So `env.sh`
does not hand it one: it asks the AWS CLI to resolve the profile — the CLI *can* prompt, and
caches the answer for the life of the session — and passes OpenTofu the temporary credentials
that come back. This needs AWS CLI 2.13 or newer for `aws configure export-credentials`; on an
older one the script falls back to the profile name and says that MFA will not work.

Doing it by hand, if you ever want to:

```sh
eval "$(aws configure export-credentials --profile todolist-qa-lifecycle --format env)"
tofu -chdir=environments/qa apply
```

**You do not have to look any of these up.** Running `env.sh up` or `env.sh down` without the
profile configured prints this stanza with your own account id, MFA serial and region already
filled in, and then carries on with whatever credentials are active.

The role has to exist before the profile is useful, and it is created when the environment is
applied — so the order is: apply `account/`, apply the environment, then add this stanza. The
profile is per environment, so `prod` gets its own with `prod` in both the profile name and the
role ARN.

```sh
AWS_PROFILE=todolist-qa-lifecycle tofu -chdir=environments/qa apply
```

The profile form is the one worth setting up: the SDK prompts for the MFA code and caches the
session, so this is one extra prompt a day rather than a ritual.

**Adding a resource later: writes stay narrow, reads are already wide.** `tofu apply` refreshes
the whole root rather than the subset it is about to change, so this role needs a *read* action
for every resource type in the module, including ones it can never write. Three applies failed in
a row on a missing one — most memorably `ec2:GetManagedPrefixListEntries`, because `ec2:Describe*`
does not match `Get*` — so the read statement now grants Describe, Get and List wholesale for
every service this project uses, including ones it does not use yet. The security boundary of
this role is its **writes**; a read changes nothing.

**S3 is the deliberate exception**, and is scoped by ARN instead. `s3:Get*` would let the qa role
read prod's state file, which holds every attribute of every prod resource — the one read worth
refusing. Object access is limited to this environment's own state key.

**What this role is not.** Creating an RDS instance needs create *and* delete on RDS, and
creating a service needs `iam:PassRole` — together that is close to administrator for the
environment. It is a scoping and audit boundary, not a security boundary: it gives you a way to
work without administrator and a log saying you chose to. That is why it is assumed by a person
and, for prod, never handed to unattended automation. Deleting the database is one API call and
the snapshot is the only way back.

## Who may deploy

Each environment gets an IAM **role**, `todolist-<env>-deploy`, assumed from GitHub Actions
through OIDC. There is no access key anywhere: a workflow job trades a signed token describing
itself for credentials that last minutes.

The role may register a task definition, point the one service at it, run the Liquibase task and
write the site bucket. It may not create, change or delete infrastructure. `doc/decisions/deployment-and-aws.md`
explains why that split is drawn there; `deploy.tf` carries the reasoning statement by statement,
including the `iam:PassRole` condition that is what makes the rest of it safe.

To use it from a workflow, take the ARN from the output and give the job the `id-token` permission
and a GitHub environment matching the AWS one:

```sh
tofu -chdir=environments/qa output -raw deploy_role_arn
```

```yaml
permissions:
  id-token: write        # without this the job cannot request a token at all
  contents: read
environment: qa          # load-bearing: the role's trust condition requires it
steps:
  - uses: aws-actions/configure-aws-credentials@v5
    with:
      role-to-assume: arn:aws:iam::<account>:role/todolist-qa-deploy
      aws-region: eu-central-1
```

The `environment:` line is not decoration. The trust policy requires a token whose subject is
`repo:<owner>@<owner-id>/<repo>@<repo-id>:environment:<env>` — this repository uses GitHub's
*immutable subject*, which carries the numeric ids so that a recreated or renamed repository is
not trusted by name alone; `gh api repos/<owner>/<repo>/actions/oidc/customization/sub` shows the
prefix — and GitHub only mints that when the job declares the environment — so for prod, where the environment is protected, AWS refuses the credentials until
the deployment has been approved.

**Names in the policy come from a `locals` block**, because most of the resources it grants access
to do not exist yet. Whichever change creates the cluster, the service, the migration task family
or the site bucket must take its name from that block, or the policy and the resource drift into
an `AccessDenied` that is very hard to read.

**Check it without credentials and without a backend** — which is what CI does, and what to run
before opening a pull request:

```sh
cd deployment/aws-tofu
tofu fmt -recursive -check -diff
python3 check-environments-match.py
python3 check-billable-guard.py
trivy config --skip-check-update --exit-code 1 --tf-vars trivy.tfvars .
for r in environments/*/ account/; do tofu -chdir="$r" init -backend=false && tofu -chdir="$r" validate; done
```

`validate` catches more than it looks like: it resolves the module, type-checks every variable,
and asks the provider's own schema whether each resource is well-formed. The apostrophe that AWS
forbids in a security group rule description was caught here, not in an apply.

**Trivy fails on every finding, at every severity.** A finding is either fixed or suppressed
with a `#trivy:ignore:<ID>` comment on the line above the resource it is reported on, under a
comment saying why — so every exception sits next to what it excuses, and a reviewer sees it in
the diff. Two of them are the design rather than an oversight: AWS-0164 on the public subnets and
AWS-0104 on the tasks' egress are both the no-NAT decision. The scan uses the checks built into
the pinned Trivy version (`--skip-check-update`), so a new check arrives with a Renovate pull
request instead of failing an unrelated change on the day it ships. Keep the local version in
step with the one in `tofu-ci.yml` for the same reason as with `tofu` (`brew install trivy`).

**Trivy scans as if the environment were up** (`--tf-vars trivy.tfvars`, which sets
`running = true`). With the defaults, every resource in `billable.tf` has a count of zero and
Trivy evaluates none of them — the database passed the scan by not existing until that was
noticed.

## `.terraform.lock.hcl` is committed, for two platforms

The lock file pins the provider to an exact version *and* its checksums. It is committed, and it
records hashes for both `darwin_arm64` and `linux_amd64` — a lock file generated by a plain `init`
on a Mac contains only the Mac hashes, and CI then fails on a checksum mismatch. Note that
OpenTofu resolves `hashicorp/aws` through **its own** registry, so a lock file written by
Terraform is not interchangeable with one written by `tofu`.

After changing the provider version:

```sh
cd deployment/aws-tofu/environments/qa
tofu providers lock -platform=linux_amd64 -platform=darwin_arm64
```

and do the same in `prod`, so the two stay in step.

## Conventions

- **Every resource is tagged** `project`, `env` and `managed-by`, via `default_tags` on the
  provider. This is load-bearing rather than tidy: with one AWS account there is no per-account
  bill, so the `env` tag is the only thing the cost budgets can filter on. An untagged resource
  is invisible to them.
- **Resource names are prefixed** `<project>-<environment>`, from `local.name` in the module, so
  two environments in one account never collide.
- **No secret goes in a `.tfvars` file.** Database credentials come from Secrets Manager, and the
  IAM users' keys never enter the repository at all.
