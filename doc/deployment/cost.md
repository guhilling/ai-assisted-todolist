# Cost

**Since #557 nothing in an environment bills by the hour.** The Go backend bills by the request,
and what is left besides is a few fixed items a month. What the container architecture cost
while it was up, measured from the bill, is [below](#until-557-the-containers), as history.

## Now

Per environment, a month:

| | Per month |
| --- | --- |
| The Go backend's requests: Lambda, API Gateway, DynamoDB, CloudFront | cents at TaskFest's traffic ([serverless.md](serverless.md#why)) |
| Its eight alarms, $0.10 each | $0.80 |
| The orphan alarm (#208), and the custom metric its log filter publishes | $0.40 |
| The Google client secret in Secrets Manager | $0.40 |
| The site and attachment buckets, the logs | cents; attachments are at most 50 MB a user |
| The dashboard, qa's Cognito test accounts, the alerts topic and its mail | nothing |
| **Total** | **about $1.60, plus requests** |

The dashboards are free because CloudWatch includes three per account and the account had one
before them; a fourth would cost $3 a month. Cognito's Lite plan is free for the first 10,000
monthly active users. The Route 53 zone, $0.50 a month, is the account's and exists for other
reasons anyway.

The Go backend's measured figures follow once a month of it is on the bill (#558). Sending its
logs to the shared monitoring server, where an environment does (#508), adds a fifth function
within Lambda's free tier and cents of data out of AWS
([observability.md](observability.md#the-monitoring-server)); the server itself, a Hetzner VM
shared with other workloads, is about €6 a month and billed outside AWS.

**Attribution:** Cost Explorer can only split these figures by environment once the `env` and
`project` tags are **activated as cost allocation tags** in the Billing console (free). Until
then it shows the account by service, which is why the figures above are per service. Activating
them only affects costs from then on.

Proposed budget alarms, for sign-off: **QA $25**, **prod $40**, **total $75**, alerting at 80% of
forecast and again at 100% of actual. They were set below what the containers cost running
continuously on purpose — an environment left up was exactly what the alarm was for.
**Not created:** the account
has three budgets instead, made by hand in the Billing console for the whole account, at $1.50,
$15 and $100 a month (as of 2026-11-14). They are what #558 tests against the Go backend's first
full month on the bill.


## Until #557: the containers

**Measured, not estimated**, from qa's bill in Cost Explorer for 1–4 October 2026 (#117). qa ran
for only a few hours in that window, so the figures below are the **hourly rates actually billed
in eu-central-1**, multiplied out; they hold however long an environment runs. Prices are net —
the invoice adds VAT (19 % in Germany), which Cost Explorer shows as a separate *Tax* line.

One environment, **while up**:

| | Billed rate | Per day | Per month, if never shut down |
| --- | --- | --- | --- |
| ALB | $0.027/h | $0.65 | $19.70, plus load-balancer capacity units, ~$0 at demo traffic |
| Fargate, 0.5 vCPU / 1 GB, x86 | $0.0284/h | $0.68 | $20.70 |
| *or* Fargate, same size, Graviton (ARM64) | $0.0227/h | $0.55 | $16.58 |
| RDS `db.t4g.micro`, single-AZ | $0.0191/h | $0.46 | $13.90 |
| RDS storage, 20 GB gp3 | $0.135/GB-month | $0.09 | $2.70 |
| **Public IPv4 address** of the task | $0.005/h | $0.12 | $3.65 |
| CloudFront, S3, CloudWatch, DNS queries | | | cents at demo traffic |
| **Total**, with x86 | **~$0.083/h** | **~$2.00** | **~$61** |
| **Total**, with Graviton, as both environments run | **~$0.077/h** | **~$1.86** | **~$56** |

**Graviton (#250)** is $0.03725 per vCPU-hour and $0.00409 per GB-hour in Frankfurt against x86's
$0.04656 and $0.00511 (AWS's price list for `eu-central-1`, 2026-10-09): 20% less for the backend
task, $0.0057 an hour, about $4 a month at 24/7. The short migrate and db-bootstrap tasks save the
same share of almost nothing. Both environments ran on Graviton.

Two things the earlier estimate (~$50) missed: **public IPv4 addresses are billed**, since 2024,
at $0.005 an hour each — the price of running the task in a public subnet instead of paying for
a NAT gateway, and still the far cheaper side of that trade — and Frankfurt's prices are a little
above the US East rates the estimate used. Seven days of backups and Performance Insights stayed
within their free allowances, as expected.

**While down** — what `env.sh down` left: about **$1 a month**. The Route 53 zone ($0.50, which
exists for other reasons anyway), the Google client secret ($0.40), and cents for the final
snapshots, the site, flow-log and attachment buckets and the logs. Attachments are at most
50 MB a user, so their storage is fractions of a cent. The orphan alarm (#208) adds about **$0.40 a
month** per environment, up or down: $0.10 for the alarm and $0.30 for the custom metric its log
filter publishes. The alerts topic, its email delivery and the SSM parameter holding the address
are free at this volume. qa's Cognito test accounts (#190) add
nothing: Cognito's Lite plan is free for the first 10,000 monthly active users, and the app
client's secret is an SSM standard parameter, which is free too — chosen over a Secrets Manager
secret, which would have been another $0.40.

That was the container architecture's cost model: **qa cost about $1.86 for each day it was up, on
Graviton, and close to nothing otherwise.** Forgetting it for a month was about $56; prod cost the
same. It is why the backend moved to Lambda ([serverless.md](serverless.md#why)).

**Image scanning**, whether the environment was up or not: Amazon Inspector at $0.09 per image's
first scan and $0.01 per rescan, plus ECR storage for at most fifteen cached images, about 3 GB
at $0.10 per GB-month — **under $1 a month** ([image scanning](image-scanning.md)).

**Avoided: a NAT gateway**, at about $33 a month per environment — the largest line item the
container architecture did not have.

