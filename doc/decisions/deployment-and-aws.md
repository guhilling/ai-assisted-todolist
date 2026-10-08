# Deployment on AWS

## Tearing an environment down is a parameter, not a destroy

**Decision.** Each environment has a `running` variable, default `false`. The resources that bill
live in `modules/environment/billable.tf`, each carrying `count = var.running ? 1 : 0`, so taking
an environment down is `tofu apply` with the variable false. `deployment/aws-tofu/env.sh` wraps
the two pieces of ceremony — the right AWS profile and the right variable — and
`check-billable-guard.py` fails the build on an unguarded resource in that file.

**Why not a separate root for the billable layer.** That was the alternative, and its appeal is
real: `tofu destroy` in a runtime root cannot reach the foundation, so there is nothing to aim.
It was rejected on two grounds. The environment roots have already been applied, so splitting
them now means migrating state keys on a live environment. And a parameter is the mechanism this
directory already uses for the only other axis it has — the difference between qa and prod — so
teardown becomes the same kind of reviewable change rather than a second concept.

**Why the default is `false`.** The cost model is that an idle environment costs nothing, so the
safe outcome of an apply nobody thought hard about should be a foundation and no bill. Defaulting
to `true` would mean the careless path is the expensive one.

**Why it is never committed to `terraform.tfvars`.** Whether an environment is up right now is a
fact about the world, not about the configuration. Committing it would make every teardown a
commit, and every `git pull` a potential surprise about what exists in AWS.

**Why the guard is checked rather than remembered.** A billable resource added without `count`
fails silently: the teardown succeeds, that one resource keeps running, and the first evidence is
the bill. That is exactly the class of mistake worth spending a check on, and the check is a
deliberately literal string match — a cleverer equivalent it cannot recognise is still something
a human has to reason about, which is what the rule exists to avoid.

**On the script.** It exists because the ceremony is two things that are quiet when wrong, not
because `tofu` is hard. It deliberately shows the plan and waits on every run, and applies the
saved plan file rather than re-evaluating, so what is applied is what was displayed. A script that
applied without showing would be how an environment gets destroyed by muscle memory.


## Deploy identities are OIDC roles, scoped to deploying and nothing else

**Decision.** GitHub Actions deploys each environment by assuming an IAM **role** through GitHub's
OIDC provider. The roles may register a task definition, update the one service, run the migration
task, snapshot the database before a migration and write the site bucket. They may not create,
change or delete any infrastructure. A human with their own privileges creates the VPC, the
database, the load balancer and the cluster.

**The snapshot grants are the downtime path's** (#215, D1): a release with a migration is deployed
by the workflow, stop–snapshot–migrate–start, instead of by a person running `down` and `up` for an
hour with an MFA session. That needed `rds:CreateDBSnapshot` and `DescribeDBSnapshots` on this
environment's instance and its snapshots, `rds:AddTagsToResource` on its *pre-release* snapshots
-- the instance copies its tags to each snapshot, and RDS checks that against the caller, which the
first downtime deploy (v0.12.0) found -- and `rds:DeleteDBSnapshot` on its *pre-release* snapshots
only, to keep the newest three. Scaling the service and running the migration were
already allowed. The role still cannot delete or modify the database, restore it, or delete a
final snapshot or touch the automated backups (seven days, point in time): a misused deploy role
could migrate the data and delete pre-release snapshots, and those two remain the way back. Its
sessions last two hours rather than one, because the path's waits together can outlast an hour,
and credentials that expire mid-start would also fail the call that leaves the service safe.

**Why the scope stops at deploying.** A credential that can run `tofu apply` needs create *and
delete* on every resource the configuration manages, which is administrator for that environment
under a different name — there is no useful way to least-privilege it. Keeping infrastructure in
human hands means that credential is never created, which is a guarantee rather than an argument.
It also matches exposure to blast radius: the deploy identity is the one used unattended and
frequently, so it is the one most likely to be abused, and scoped this way the worst case is a bad
deployment rather than a dropped database.

**Why roles and not users with access keys.** This reverses the earlier plan. An access key is a
long-lived secret stored in GitHub; an OIDC role issues credentials that expire in minutes and
stores nothing, so there is no key to leak and no rotation to schedule. It also lets the trust
condition name the GitHub *environment* as well as the repository, which turns the prod approval
gate into an AWS refusal instead of only a GitHub courtesy. A secondary benefit: `aws_iam_access_key`
writes its secret into OpenTofu state in cleartext, and with roles the question does not arise.

**Two limits, recorded rather than discovered later.**

- `ecs:RegisterTaskDefinition` cannot be scoped to a resource, because the call creates one and
  there is no ARN or tag to condition on. The qa role can therefore register a revision in prod's
  task definition family. This is accepted: a task definition nobody runs is inert, and both calls
  that could run or deploy one are scoped to this environment's cluster and service. It does mean
  the earlier plan's "denied everything tagged `env=prod`" is not literally achievable.
- The policy scopes by **explicit ARN**, not by resource tag. With each identity touching a
  handful of resources whose names the project chooses, ARNs are both tighter and simpler. A
  tag-based `Deny` was considered and rejected as theatre: every other statement is already
  ARN-scoped to one environment, and the one statement that is not has no resource to carry a tag.

**One consequence for how the code is written.** The policy names resources that do not exist yet —
the cluster, the service, the migration task family, the site bucket. It can do so because those
names are *chosen* rather than generated, so they live in a `locals` block that the changes
creating those resources must also use. CloudFront is the exception: a distribution's id is
generated by AWS, so `cloudfront:CreateInvalidation` is deliberately absent until the change that
creates the distribution can scope it to a real ARN, rather than being granted on `*` in advance.


## OpenTofu rather than Terraform

**Decision.** The AWS infrastructure under `deployment/aws-tofu/` is OpenTofu. The binary is
`tofu`, CI pins 1.12.6, and `required_version` is `>= 1.10`.

**Why.** The choice was made after comparing the two, and the honest summary is that Terraform
was the safer default and lost on two specific features:

- **A backend block can interpolate a variable** (OpenTofu 1.8). Terraform evaluates nothing in
  a backend block, so the state key has to be written out per environment. That made `backend.tf`
  the one file the environment roots could not share, and so the one exception
  `check-environments-match.py` had to carve out. On OpenTofu the roots are identical apart from
  `terraform.tfvars`, and the exception is gone — which matters because *prod is a parameter
  change from qa* is the design of that directory, and every exception is somewhere drift can
  hide.
- **The S3 backend locks using S3** (OpenTofu 1.10), so there is no DynamoDB table to create,
  pay for, or forget when tearing an environment down. The bootstrap is one bucket.

Licensing was the reason to look, not the reason to switch. OpenTofu is MPL-2.0 where Terraform
is BUSL-1.1, but BUSL only forbids offering a competing infrastructure-as-code product; using it
to manage your own infrastructure is unrestricted, and neither licence touches this repository's
own Apache-2.0.

**What it costs, stated rather than discovered later.** Terraform is what a commercial project is
more likely to use, and this environment is partly a proof-of-concept for one — so HCP Terraform,
Stacks and Sentinel are all out of reach, and documentation for awkward edge cases is thinner.
The languages and the provider protocol are the same, so the knowledge transfers; the tooling
around them does not entirely. Two further notes: state files stay compatible in both directions
*unless* OpenTofu's state encryption is enabled, which is a one-way door and is not used here;
and file names stay `.tf` and `terraform.tfvars` rather than OpenTofu's optional `.tofu`
extension, because every example and every provider document is written that way.


The plan is [the deployment chapter](../deployment/index.md); these are the choices in it that had a real alternative. Nothing is
built yet — #60 produced the plan deliberately, because several of these are hard to reverse once
anything exists.

## One AWS account, with IAM roles and resource tags

This reverses an earlier decision to use
separate accounts. The hosted zone and the certificates live in the existing account, and
splitting turned every DNS record and every ACM validation into a cross-account operation — for
two hostnames.

## What it costs is stated rather than glossed

With separate accounts, "prod is never created
by an automated agent" was enforceable because the prod account held nothing to assume. In one
account it is a policy: three technical IAM users, one per job, scoped by resource tag — a QA
deployer denied everything tagged `env=prod`, a prod deployer whose key lives in a GitHub
environment that requires human approval, and a read-only user for monitoring. The hole that remains is local credentials — an agent
running with an administrator profile could reach prod, and only a least-privilege local profile
stops it. That is a discipline, not a wall. The wall was the account boundary, and it was traded
for not having to cross an account boundary to write two DNS records.

A second consequence: with no per-account bill, cost attribution moves to tags, and an untagged
resource becomes invisible to both environment budgets.

## PostgreSQL on RDS, destroyed with a final snapshot when idle

The database is managed because
this stands in for a commercial project and a managed database is part of what it proves.
*Rejected: stopping the instance.* It still bills storage, and **AWS restarts a stopped instance
after seven days**, so it does not survive a demo that is idle for weeks. *Rejected: Aurora
Serverless v2 with scale-to-zero*, which pauses properly and resumes in about fifteen seconds —
but it is Aurora rather than plain RDS, and the commercial project this represents would use
plain RDS. *Rejected: PostgreSQL as a container*, the original plan, for the same reason RDS was
chosen.

## The application authenticates to RDS with IAM, not a password

The task role is the
credential: a token signed per connection by a Quarkus `CredentialsProvider`, which Agroal asks
again for every connection it opens — `DatasourceCredentialsPerConnectionTest` holds it to that,
because a token fetched once would fail 15 minutes after the first connection was replaced.
*Rejected: injecting the database password from Secrets Manager* through the task definition.
RDS rotates a managed secret every seven days and ECS reads it only at task start, so a running
task would keep the old one; it would also have meant the application using the master user.
*Rejected: the AWS Advanced JDBC Wrapper*, which does the same signing inside a replacement
driver. It would have needed `db-kind=other`, an explicit Hibernate dialect, and Dev Services
replaced, where the credentials provider leaves the PostgreSQL driver and every test untouched.
*Decided: one database user per environment*, `taskfest_<env>`, for both the application and
the migrations, and the IAM grant names that user rather than the instance — an instance's
resource id changes with every restore, while the user travels with the snapshot.

## The database user is created by a one-off ECS task, run by a person

It is the only thing
that needs the master credentials, and it is needed once per environment, so it is a task the
lifecycle role may run and the deploy role may not, started by `env.sh db-bootstrap`. ECS
injects the credentials when the task starts, so the seven-day rotation that ruled out injecting
them into the service does not apply to a task that lives for seconds. The master secret is
matched by the `aws:rds:primaryDBInstanceArn` tag RDS puts on it, because its name is random and
changes with every restore. *Rejected: the backend creating its own user at start-up*, which
would put the master credentials in the service. *Rejected: a Lambda in the VPC*, which is more
infrastructure for something that runs once.

## The frontend is static on S3 behind CloudFront, with `/api/*` on the same distribution

No
container, no task, no image to patch — which is also part of the answer to #66. The second
origin is not optional: httpd currently serves the SPA *and* proxies the API, and that
same-origin arrangement is what the OIDC `redirect_uri` and the session cookie depend on.
Serving only S3 would break sign-in after deployment, where nothing local would catch it.
*Rejected: the frontend container on ECS*, which keeps local and production identical at the cost
of a load balancer target, a task and a base image that needs patching forever.

## GitHub Actions, not CodePipeline

One pipeline rather than two, and the prod gate is a
protected environment. It runs as a **technical IAM user per environment** rather than assuming a
role through OIDC, which is what was asked for. The cost is **long-lived access keys** held as
GitHub secrets, where OIDC would have issued short-lived credentials and stored nothing; least
privilege by tag, rotation, and an alarm on use from outside Actions are the mitigations, and
moving to OIDC later changes nothing else in the plan. Cost did not decide the CodePipeline
question — a V1 pipeline is
about a dollar a month and CodeDeploy is free for ECS. *Rejected: CodePipeline*, which would be
right if demonstrating AWS-native CI/CD were itself the point, or if blue/green still required
CodeDeploy. It no longer does: ECS has blue/green natively, which removed the main argument.

## Two deployment paths rather than expand-and-contract

A release with no migration goes
blue/green with zero downtime and an instant rollback; a release with a migration takes the
downtime, because nothing old running means nothing needs to be backward-compatible. The image
carries the schema it expects and the deployment picks the path. *Rejected: expand-and-contract
everywhere*, the usual answer, which buys zero-downtime schema changes at the cost of every
change shipping in two releases — not worth it when downtime is acceptable. *Rejected:
`migrate-at-start` in production*, which on ECS would migrate from a new task while an old one
still served.

## The load balancer stays, and is internal

It is the largest fixed cost in an environment
(~$16 a month, idle or not), so it was challenged. It stays because **ECS blue/green shifts
traffic between two target groups**, which is a load balancer's job — there is no
load-balancer-free form of it, and demonstrating blue/green is one of the reasons this
deployment exists. *Rejected: a Network Load Balancer*, the same price per hour, and worse here —
ECS adds a ten-minute delay to the blue/green lifecycle stages with an NLB and supports only
all-at-once shifting. *Rejected: CloudFront straight to the ECS service*, which VPC origins do
not support and which a changing task IP would break anyway. *Rejected: an API Gateway HTTP API
with a VPC link* — which is cheaper, but by less than it appears. **A VPC link is $0.01/hour,
about $7.20 a month, charged at zero traffic**, so the comparison is $16 against $7.20 and the
saving is about nine dollars an environment, not sixteen. That nine dollars buys the blue/green
demonstration, and it only applies while an environment is up — which, by design, QA usually is
not. The real lever is destroying idle environments, and it destroys the load balancer too.

*Rejected: one load balancer shared by both environments* with host-based rules. It would halve
the cost only while both are up, which is the uncommon case, and it cannot be destroyed with
either environment — so it needs a third OpenTofu stack and couples the two together.

It is **internal**, reached through a CloudFront VPC origin, so it has no public address.
*Rejected: a public load balancer with a shared secret header* that CloudFront sends and the
load balancer checks — the older pattern, which works but leaves a bypass that depends on a
secret staying secret. VPC origins remove the public address instead, at no cost.

## Custom hostnames under an existing zone

`taskfest-qa.cloud.hilling.de` and
`taskfest.cloud.hilling.de`, as alias records to each environment's distribution. This is what
makes the Google OIDC redirect URIs knowable before the environments exist, which matters
because that configuration is manual and cannot be automated here. One consequence is worth
recording rather than rediscovering: **the ACM certificate must live in `us-east-1`**, whatever
region the environment uses, because CloudFront accepts certificates from nowhere else.

They are **alias records, not `CNAME`s**. Route 53 does not charge for queries to an alias record
pointing at an AWS resource, while a `CNAME` is $0.40 per million — and a `CNAME` to another name
in the same zone is billed as two queries, because the resolver asks twice. The amounts are
trivial at demo traffic; the point is that the alias is free, needs one lookup instead of two,
and is the only one of the two that works at a zone apex. *Rejected: CloudFront's own domain*,
which would have worked and would have left the sign-in configuration undoable until after the
first deployment.

## Fargate tasks in public subnets, with no NAT gateway

A NAT gateway is about $33 a month
before data — more than the database, and the largest line item in an environment that would
otherwise cost about $50. The tasks take a public IP and are reachable from nothing: the security
group admits only the load balancer. *Rejected: private subnets with a NAT gateway*, which is
what a commercial deployment should do and what the plan says to do when this stops being a demo.
*Rejected: VPC endpoints instead of NAT*, which is cheaper than NAT but still per-endpoint, and
more moving parts than a demo justifies. Without endpoints there is also no *request-side* VPC restriction:
`aws:SourceVpc` is only set on a request that goes through one, and `aws:Ec2InstanceSourceVpc`
covers EC2 instance credentials, not Fargate task roles. What is restricted by VPC instead is where
the deploy and lifecycle roles may *place* the service and the load balancer — see
[Accounts and access](../deployment/access.md).

## VPC flow logs go to S3, all traffic, for 30 days

Delivery to S3 is about half the per-GB
price of CloudWatch Logs and needs no delivery role, and logs read when something needs
explaining do not need CloudWatch's query console. All traffic rather than rejected-only, because
the useful question is what talked to what. The bucket is encrypted with S3-managed keys:
*rejected: a customer-managed KMS key*, which at about $1 a month costs more than the logs.

## CloudFront's `/api/*` origin comes and goes with the environment; the distribution stays

A
VPC origin names one load balancer ARN and cannot be changed or deleted while a distribution uses
it, so destroying the load balancer on `down` means detaching and deleting the VPC origin, and
`up` means creating a new one and attaching it — up to ~15–20 minutes each way. The lifecycle
role therefore may update this environment's one distribution and create and delete VPC origins,
and still cannot create or delete distributions. *Rejected: keeping the load balancer up
permanently*, which would leave the distribution untouched and `up`/`down` fast, for about $20 a
month even while qa is down. *Rejected: the distribution coming and going too*, which is no faster
and needs more rights. An earlier version of this choice claimed the distribution could stay
untouched while the origin changed; it cannot.

## CloudFront reaches the load balancer over HTTPS with the environment's own name

The ALB
carries a regional ACM certificate for `taskfest-<env>.cloud.hilling.de`, the same name as
CloudFront's own (which has to be in us-east-1). That works because `/api/*` forwards the viewer's
`Host` header, and AWS documents that the origin certificate may then match the `Host` header
instead of the origin's domain name — so no second name for the load balancer is needed. Both
certificates validate through the same DNS record.

## ECS-native blue/green, which needed AWS provider 6

Two target groups, a production listener
rule ECS moves between them, a bake with both versions running (two minutes in qa, five in prod), and the circuit
breaker for a deployment whose tasks never become healthy. Provider 5.x has no
`deployment_configuration` for it; the upgrade was its own pull request (#111), and a plan of
every root showed no change from it. *Rejected: CodeDeploy*, which the plan had already ruled out.

## The frontend's deep links are a CloudFront Function, and a release needs no invalidation

A
path whose last segment has no dot is a client-side route and gets `index.html`; anything else is
a file and is served as itself. *Rejected: CloudFront custom error responses* (403/404 →
`/index.html`), the common recipe, because they are distribution-wide: an API 404 would have come
back as the app with a 200. `index.html` is uploaded with `no-cache` instead of being invalidated,
so the deploy role still needs no `cloudfront:CreateInvalidation`, and the hashed assets are never
deleted, so a rollback is only the previous release's `index.html`. *Decided by Gunnar:* the
frontend half of the deploy workflow came forward (#119) rather than uploading by hand, because
the release mechanism needed testing anyway.

## Image vulnerabilities come from Amazon Inspector, through ECR's pull-through cache

ECS pulls the backend image from ECR, which caches it from Quay on first use. Amazon Inspector
scans what lands there, continuously, and a workflow every six hours turns fixable HIGH and CRITICAL
findings in recently used images into one GitHub issue (#162,
[image scanning](../deployment/image-scanning.md)). *Decided by Gunnar*, partly as a
demonstration of the AWS-native route.

*Rejected: a scheduled Trivy scan in CI.* It would have cost nothing and reused a tool the repository
already has, and was the recommendation. It scans a tag rather than what ECS runs, though, and
it shows nothing in AWS. *Rejected: Quay's own scanning and notifications.* Its results are
available through Quay's public API, so access was not the issue, but its notifications cannot
leave out vulnerabilities without a fix. That is most of what the base image reports, so every
mail would have been noise. Inspector adds what neither has: rescans when a CVE is published,
the link between an image and the ECS tasks that ran it, and a filter on whether a fix exists.
*Cost:* under a dollar a month (doc/deployment/cost.md). The notification is a GitHub issue
rather than email, like the SonarCloud gate's.


## qa's test accounts are a Cognito pool, and its client secret is in OpenTofu state

**Decision (#190, D2 and D4 on #141).** qa's live tests sign in with two accounts in a Cognito user
pool, a second provider beside Google. The accounts have no stored password — the live-test run
sets one per run. The app client's secret, which Cognito generates, is accepted in OpenTofu state
and handed to ECS through an SSM SecureString.

**Why Cognito.** Google forbids automating its sign-in, so a test needs a provider whose login page
a machine may fill in. Cognito is managed, in the same account, and free at two users (Lite plan).

**Why no stored password.** A password set at the start of each run and kept in memory cannot leak
from a store or go stale, and costs nothing; Secrets Manager would have cost $0.40 a month and a
role that reads it.

**Why the client secret in state is acceptable.** Unlike Google's, it cannot be kept out: the
client resource holds it whatever is done. The state bucket is encrypted and readable only by
administrators and the environment's own roles, and the secret signs nobody in without an
account's password, which exists only during a test run. The Google secret stays out of state as
before.

**Why SSM rather than Secrets Manager for it.** A standard SecureString parameter is free, and
needs no rotation either; Secrets Manager's features buy nothing here.

