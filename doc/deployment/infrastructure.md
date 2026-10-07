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

`account/` holds the GitHub OIDC provider, the monitoring user, and the image scanning: ECR's
pull-through cache for quay.io, Amazon Inspector, and the read-only role the findings workflow
uses ([image scanning](image-scanning.md)). Its permissions come from a
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
| **qa only:** Cognito user pool `taskfest-qa-test-accounts`, its app client and prefix domain, two accounts, the client secret in SSM | The test accounts the live tests sign in with (`test-sign-in.tf`, #190); foundation, so they survive `down`. Switched by `test_sign_in` in `terraform.tfvars`; with them the role `taskfest-qa-live-test`, which may only set the accounts' passwords for a live-test run (#144) |
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
endpoints, and the reasoning is in [decisions/deployment-and-aws.md](../decisions/deployment-and-aws.md).

