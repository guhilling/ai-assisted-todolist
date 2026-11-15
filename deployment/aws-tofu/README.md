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

The difference is in each `terraform.tfvars`: the environment's name and hostname, how long its
logs are kept, its Google clients, qa's test accounts, the Go backend's table and its
point-in-time recovery, and the monitoring server, which only qa sends to.

## What it holds

The Go backend on Lambda with DynamoDB, behind CloudFront with the site. Until #557 it also held the
container architecture, Quarkus on Fargate behind a load balancer with PostgreSQL on RDS, in its
VPC;
[this directory in the tag `pre-serverless`](https://github.com/guhilling/ai-assisted-todolist/tree/pre-serverless/deployment/aws-tofu)
has it, and is the way back.

| File | What it holds |
| --- | --- |
| `edge.tf` | The hostname, its certificate, the site bucket, the CloudFront distribution with its two origins, and the routing function |
| `serverless.tf` | The Go backend's table, the `api` function and the HTTP API |
| `serverless-jobs.tf` | The background functions, their schedules and the Go backend's alarms |
| `serverless-dashboard.tf` | The Go backend's CloudWatch dashboard |
| `monitoring.tf` | The subscription filters that send the logs to the monitoring server, where there is one |
| `attachments.tf` | The attachment bucket, which refuses to be destroyed |
| `alerting.tf` | The alerts topic, its mail subscription and the orphan alarm |
| `sign-in.tf` | The Google client secret, created empty |
| `test-sign-in.tf` | qa's Cognito test accounts and the live-test role |
| `deploy.tf` | The deploy role GitHub Actions assumes |

There is no VPC: no function runs in one.

## Bootstrapping the state bucket, once

OpenTofu cannot create the backend it is about to use, so the bucket is made by hand, once, before
the first `init`. Both environments share it; their state files are separated by key, not by
bucket. There is no lock table — the S3 backend takes its lock from the bucket.

The bucket keeps the application's old name, `todolist-tofu-state`, for historical reasons. A
bucket cannot be renamed, and moving the state to a new one buys nothing: nobody but OpenTofu ever
sees the name.

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

**Apply is a human's job.** There is deliberately no credential that can run it — see *Who may
deploy* below — so it is run with an administrator's profile, through `env.sh`.

Once, first, and again whenever `account/` changes:

```sh
TASKFEST_ACCOUNT_AWS_PROFILE=<your admin profile> ./deployment/aws-tofu/env.sh account
```

Then an environment, before the first apply `serverless/build.sh` so the functions can be created:

```sh
TASKFEST_QA_AWS_PROFILE=<your admin profile> ./deployment/aws-tofu/env.sh up qa
TASKFEST_PROD_AWS_PROFILE=<your admin profile> ./deployment/aws-tofu/env.sh up prod
```

`env.sh` resolves the profile through the AWS CLI -- which asks for the MFA code OpenTofu cannot
ask for itself -- shows the plan, and applies the **saved plan file** once you confirm, so what is
applied is exactly what was displayed. `--yes` skips the prompt. A plain `tofu apply` with a profile
that assumes an MFA-protected role fails with *"assume role with MFA enabled, but
AssumeRoleTokenProvider session option not set"*. The state key differs per environment, so the
two never see each other.

**`up`, `down`, `status`, `migrate` and `db-bootstrap` are gone**, with the container architecture
they were for (#557). Each stops with a note pointing at `apply`, rather than doing something
else under a name people have in their fingers.

**Which profile it uses**, in this order:

1. `TASKFEST_<ENV>_AWS_PROFILE` for the root named — `TASKFEST_QA_AWS_PROFILE`,
   `TASKFEST_PROD_AWS_PROFILE` or `TASKFEST_ACCOUNT_AWS_PROFILE` — if set;
2. `AWS_PROFILE`, if set.

There is no default. The per-root variables are optional and each person's own; set them in your
shell's startup file (`~/.zshrc`) if you keep a global `AWS_PROFILE` for other work, which they win
over:

```sh
export TASKFEST_QA_AWS_PROFILE=my-admin
export TASKFEST_PROD_AWS_PROFILE=my-admin
export TASKFEST_ACCOUNT_AWS_PROFILE=my-admin
```

**A profile that assumes no role is refused** — one with neither a `role_arn` nor an SSO role, which
is an IAM user's own credentials, and failed with a bare 403 on the state bucket — and so is a
lifecycle role's, `taskfest-<env>-lifecycle`, whose roles went with the containers. `env.sh` stops
before anything runs and says which profile, from which variable, and what to use instead.
`.github/scripts/test_env_sh.py` pins the order and the refusals.

**OpenTofu cannot prompt for the MFA code**, so `env.sh` does not hand it the profile name: it
asks the AWS CLI to resolve the profile — the CLI *can* prompt, and caches the answer for the life
of the session — and passes OpenTofu the temporary credentials that come back. This needs AWS CLI
2.13 or newer for `aws configure export-credentials`; on an older one the script falls back to the
profile name and says that MFA will not work. By hand:

```sh
eval "$(aws configure export-credentials --profile <your admin profile> --format env)"
tofu -chdir=environments/qa apply
```

**IAM changes take a while to reach every region.** AWS applies a policy change *eventually*: in
one region it is in effect at once, in another it can take seconds to minutes. After an apply that
changes the deploy role or a function's role, **wait a minute** before using it. An
`AccessDenied` for an action the policy **does** grant is this, not a missing permission; the
simulator tells the two apart:
`aws iam simulate-principal-policy --policy-source-arn <role arn> --action-names <action>
--resource-arns <resource arn>` — `allowed` means wait and run again, `implicitDeny` that the
policy really lacks it.

## Who may deploy

Each environment gets an IAM **role**, `taskfest-<env>-deploy`, assumed from GitHub Actions
through OIDC. There is no access key anywhere: a workflow job trades a signed token describing
itself for credentials that last minutes.

The role may deploy the Go backend's functions — upload their code, publish a version, invoke the
API's to check it and move each alias `live` — and write the site bucket. It may not create, change
or delete infrastructure, and it passes no role. `doc/decisions/deployment-and-aws.md` explains why
that split is drawn there; `deploy.tf` carries the reasoning statement by statement.

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
      role-to-assume: arn:aws:iam::<account>:role/taskfest-qa-deploy
      aws-region: eu-central-1
```

The `environment:` line is not decoration. The trust policy requires a token whose subject is
`repo:<owner>@<owner-id>/<repo>@<repo-id>:environment:<env>` — this repository uses GitHub's
*immutable subject*, which carries the numeric ids so that a recreated or renamed repository is
not trusted by name alone; `gh api repos/<owner>/<repo>/actions/oidc/customization/sub` shows the
prefix — and GitHub only mints that when the job declares the environment — so for prod, where the environment is protected, AWS refuses the credentials until
the deployment has been approved.

**Names in the policy are chosen, not generated** — `taskfest-<env>-<function>`,
`taskfest-<env>-site` — so the policy names them by ARN. A resource renamed without the policy
following drifts into an `AccessDenied` that is very hard to read.

**Check it without credentials and without a backend** — which is what CI does, and what to run
before opening a pull request:

```sh
cd deployment/aws-tofu
tofu fmt -recursive -check -diff
python3 check-environments-match.py
trivy config --skip-check-update --exit-code 1 --tf-vars trivy.tfvars .
node --test modules/environment/spa-routing.test.mjs
shellcheck env.sh
for r in environments/*/ account/; do tofu -chdir="$r" init -backend=false && tofu -chdir="$r" validate; done
```

`validate` catches more than it looks like: it resolves the module, type-checks every variable,
and asks the provider's own schema whether each resource is well-formed. The apostrophe that AWS
forbids in a security group rule description was caught here, not in an apply.

**Trivy fails on every finding, at every severity.** A finding is either fixed or suppressed
with a `#trivy:ignore:<ID>` comment on the line above the resource it is reported on, under a
comment saying why — so every exception sits next to what it excuses, and a reviewer sees it in
the diff. The scan uses the checks built into the pinned Trivy version (`--skip-check-update`), so
a new check arrives with a Renovate pull request instead of failing an unrelated change on the day
it ships. Keep the local version in step with the one in `tofu-ci.yml` for the same reason as with
`tofu` (`brew install trivy`).

**Trivy scans qa's test accounts too** (`--tf-vars trivy.tfvars`, which sets `test_sign_in =
true`). With the defaults they have a count of zero, and Trivy would evaluate none of them.

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
  is invisible to them. Not tagged by OpenTofu: the `cloud.hilling.de` zone and the state bucket,
  which were created outside it and are tagged by hand.
- **Resource names are prefixed** `<project>-<environment>`, from `local.name` in the module, so
  two environments in one account never collide.
- **No secret goes in a `.tfvars` file.** The Google client secret is put into Secrets Manager by
  hand, and the monitoring password into SSM; neither enters the repository.
