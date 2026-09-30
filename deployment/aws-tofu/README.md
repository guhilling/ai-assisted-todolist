# AWS infrastructure

The AWS environments, `qa` and `prod`, written in **OpenTofu**.
`doc/deployment.md` is the plan this implements and holds the reasoning;
`doc/decisions.md` records why OpenTofu and not Terraform. This file is how to run it.

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
```

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

The network and the security groups — the layer everything else attaches to.

| File | What it holds |
| --- | --- |
| `network.tf` | VPC, two public subnets, two private subnets, internet gateway, route tables |
| `security.tf` | The four-hop chain: CloudFront → load balancer → task → database |

Three properties of the network are deliberate and will look wrong without the reason:

- **There is no NAT gateway.** At about $33/month per environment it would have cost more than
  the database. The ECS tasks therefore run in the *public* subnets with public IPs, and what
  keeps them private is the security group in `security.tf`, which lets nothing but the load
  balancer open a connection to them.
- **The private subnets have a route table with no routes.** That is what "no NAT" looks like
  written down. They exist for the internal load balancer and, later, the database.
- **Two availability zones because the load balancer requires two**, not for high availability.
  A single task in one AZ is not highly available, and the plan does not claim it is.

Still to come, each as its own change: RDS and Secrets Manager; ECS, the ALB and its target
groups; S3, CloudFront, ACM and Route 53; the CloudWatch alarms, budgets and IAM users.

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

```sh
cd deployment/aws-tofu/environments/qa
tofu init
tofu plan
tofu apply
```

`prod` is the same commands in the other directory. The state key differs, so the two never see
each other.

**Check it without credentials and without a backend** — which is what CI does, and what to run
before opening a pull request:

```sh
cd deployment/aws-tofu
tofu fmt -recursive -check -diff
python3 check-environments-match.py
for e in environments/*/; do tofu -chdir="$e" init -backend=false && tofu -chdir="$e" validate; done
```

`validate` catches more than it looks like: it resolves the module, type-checks every variable,
and asks the provider's own schema whether each resource is well-formed. The apostrophe that AWS
forbids in a security group rule description was caught here, not in an apply.

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
