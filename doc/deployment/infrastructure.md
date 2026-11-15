# The code and what it creates

## Where the code is

`deployment/aws-tofu/` implements this, and its `README.md` covers running it — bootstrapping
the state bucket, the credential-free checks that CI runs, and the provider lock file.

**The tool is OpenTofu, not Terraform.** The language is identical, the binary is `tofu`, and
two of its features are used deliberately: a backend block may interpolate a variable, so the
environment roots share one `backend.tf`; and the S3 backend takes its lock from S3, so there
is no DynamoDB table. [decisions/deployment-and-aws.md](../decisions/deployment-and-aws.md) records the choice.

The layout is one module holding every resource, instantiated by a thin root per environment:

```
modules/environment/     every resource, parameterised
environments/qa/         a root that instantiates the module
environments/prod/       the same root, different values
account/                 the things there is one of per AWS account
```

`account/` holds the GitHub OIDC provider, the monitoring user and the documentation site's DNS
name; the image scanning it held for the containers went in #557
([image scanning](image-scanning.md)).
The monitoring user's permissions come from a `read-only` group: `ReadOnlyAccess`, everything
**denied without MFA** except registering a device, and the state bucket's objects denied even with
it, as are people's attachments, SSM parameters, Cognito app clients' secrets and the functions'
settings (#430, #554). `ReadOnlyAccess` reads every bucket, so without the MFA rule a leaked access
key would have read prod's state. From the CLI the user therefore needs a session from
`aws sts get-session-token --serial-number … --token-code …`; the bare access key is refused.
It exists because those are
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


## Applying

Every apply is a person's, with an administrator's profile; no credential in CI can apply
([access.md](access.md)). `env.sh` does the ceremony: it resolves the profile through the AWS CLI,
which can ask for the MFA code OpenTofu cannot, shows the plan, and applies the saved plan once
confirmed.

```sh
deployment/aws-tofu/env.sh account       # the account-wide root, first
deployment/aws-tofu/env.sh up qa      # an environment
deployment/aws-tofu/env.sh up prod
```

The profile is named in `TASKFEST_<ENV>_AWS_PROFILE` (`TASKFEST_QA_AWS_PROFILE`,
`TASKFEST_ACCOUNT_AWS_PROFILE`, …) or else `AWS_PROFILE`; there is no default. `up`, `down`,
`status`, `migrate` and `db-bootstrap` were the container architecture's, and stop with a note now
([teardown.md](teardown.md)).


## Resource inventory

Per environment, identical unless noted. The Go backend's resources, its table, functions, HTTP
API, schedules and alarms, are listed in [serverless.md](serverless.md#the-infrastructure).

| Resource | Why |
| --- | --- |
| Alerting: SNS topic `taskfest-<env>-alerts`, Gunnar's email subscribed (address from the SSM parameter `/taskfest/alert-email`), and the alarm `taskfest-<env>-orphan-alert` | Mail when the orphan clean-up finds more than two orphans (#208), counted by a metric filter on the `orphans` function's log (`alerting.tf`, `serverless-jobs.tf`); the Go backend's other alarms notify the same topic |
| Attachments bucket `taskfest-<env>-attachments` | The files on tasks (#204, `attachments.tf`). Private, TLS only, no versioning so a deleted file is gone; CORS lets the site PUT and GET. The Go backend's functions may touch only `serverless/` in it; the Quarkus backend's files are still at the top level. It refuses to be destroyed (#435) |
| ACM certificate in **us-east-1** | CloudFront accepts certificates from that region only |
| Route 53 alias records | In the same account as everything else; free to query |
| **qa only:** Cognito user pool `taskfest-qa-test-accounts`, its app clients (the backend's and the mobile app's) and prefix domain, two accounts | The test accounts the live tests sign in with (`test-sign-in.tf`, #190). Switched by `test_sign_in` in `terraform.tfvars`; with them the role `taskfest-qa-live-test`, which may only set the accounts' passwords for a live-test run (#144) |
| Secrets Manager | The Google client secret, value set by hand (`sign-in.tf`) |
| IAM role `taskfest-<env>-deploy` | What GitHub Actions deploys with ([access.md](access.md)) |
| S3 bucket, private | The built SPA; reachable only through CloudFront's origin access control |
| CloudFront distribution | The site bucket, and `/api/*` to the Go backend's HTTP API |
| CloudWatch log groups, alarms, dashboard | See *Observability* and serverless.md |
| AWS Budgets | See *Cost*; made by hand, not here |

There is no VPC: no function runs in one, so the network the containers needed, its subnets,
security groups and flow logs went with them (#557). The container architecture's resources are
in the tag `pre-serverless`.
