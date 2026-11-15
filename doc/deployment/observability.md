# Observability

What watches TaskFest, as built (checked against `deployment/aws-tofu` on 2026-11-14, #558). The
Go backend serves qa and prod. The
[architecture diagram](../../README.md#how-the-application-fits-together) draws how it is
watched.

**The Go backend** (qa and prod, #557):

- **Logs.** Each of the five functions writes to its own CloudWatch log group, and the HTTP API
  writes an access log, one line per request with its path, status and latency; JSON lines, 30 days
  in qa and 90 in prod (`serverless.tf`, `serverless-jobs.tf`).
- **Alarms**, nine per environment, on what a function-based backend shows: the API function's
  errors and throttles, the HTTP API's server errors (five in five minutes) and its request count
  (50,000 in an hour, #607), the stream function
  falling behind, the scheduled jobs' errors, and the table's throttles. Thresholds and reasons are
  in [serverless.md](serverless.md#the-infrastructure). And the orphan alert: a metric filter on
  the clean-up's log counts the alert line.
- **A dashboard**, `taskfest-<env>-go-backend`, in CloudWatch: requests and their answers, time,
  errors, throttles, the stream's lag and the table. Free: the account's first three dashboards are.
- **The shared monitoring server** (#508), qa only: the log lines also go to VictoriaLogs on a
  Hetzner VM, where Perses draws latency percentiles by route, cold starts and memory from them,
  beside the lines themselves. Not all of them: logship's own log stays in CloudWatch, the lines
  that only mark an invocation's start and end are left out, and a batch that fails three times is
  dropped. CloudWatch keeps every line. Below: [The monitoring server](#the-monitoring-server).
- **Metrics of its own:** none. Lambda's and API Gateway's are in CloudWatch, and the logs carry the
  rest -- which is why the monitoring server's figures come from the access log and the `REPORT`
  lines.

**The containers** went from the infrastructure in #557, and with them their log group, its saved
queries and the up-time reminder;
[this page in the tag `pre-serverless`](https://github.com/guhilling/ai-assisted-todolist/blob/pre-serverless/doc/deployment/observability.md)
describes what watched them.

**Besides:**

- **Alerting to** an SNS topic per environment, `taskfest-<env>-alerts`, with Gunnar's address
  subscribed by mail (`alerting.tf`). Every alarm above notifies it, on entering ALARM and on
  returning to OK.
- **Budgets**, account-wide and made by hand in the Billing console, not in OpenTofu: one at $1.50,
  one at $15 and a last warning at $100 a month, as of 2026-11-14. The per-environment budgets
  [cost.md](cost.md) proposed were not created; with the Go backend's costs a month at a time, the
  hand-made ones are what remains to be tested against the new bill (#558).
- **Traces.** None. One function in front of one table does not repay X-Ray; when the commercial
  shape has more than one service, this is where it goes.

## Plan: how long a page takes to show (#236)

Not built yet; this is the plan #236 asked for. The question is how long the board takes from the
click to tasks and previews on screen, and where that time goes. Four steps, cheapest first, each
useful on its own:

1. **Measure in the lab, against qa, in the live run.** Playwright already signs in on qa after
   every deploy. A spec reads the browser's own timings — Navigation Timing, Largest Contentful
   Paint, and Resource Timing per preview, whose `transferSize` of 0 shows a cache hit — and
   writes them to the run summary. Free, the same every time, and enough to show before and after
   a change such as thumbnails. It says nothing about real networks or devices.
2. **Mark the application's own moments.** `performance.mark` when the task list has arrived and
   when the board has rendered it, so the timings name "board ready" rather than only the browser's
   generic events. A few lines in the frontend, read by step 1 and step 3 alike.
3. **Collect from real browsers.** The timings of step 1 and 2, sent with `navigator.sendBeacon`
   once a page has settled: either to a small backend endpoint that logs them as a structured line —
   CloudWatch Logs Insights then gives percentiles, at no new cost — or to CloudWatch RUM, managed,
   at about a dollar per 100,000 events. Either way it is data about visitors, so the privacy
   policy changes with it, and the decision is Gunnar's.
4. **Trace the backend's part.** A `Server-Timing` header first: the browser shows it in its
   developer tools and in Resource Timing, so steps 1 and 3 see the backend's share without a
   tracing system. OpenTelemetry (`quarkus-opentelemetry`) to X-Ray, with the browser's requests
   carrying `traceparent`, only once there is more than one service to follow a request through —
   as the bullet on traces above says.

## Alerting: the address, and the one-time setup

The address the alerts go to is **not in the repository**. It lives in an SSM parameter,
`/taskfest/alert-email`, one for the account, which `alerting.tf` reads; a standard `String`
parameter is free. Create it once, before the first apply that includes `alerting.tf` -- the plan
fails without it:

```sh
aws ssm put-parameter --name /taskfest/alert-email --type String --value '<the address>'
```

After each environment's apply, AWS mails that address a confirmation link per topic (one for qa,
one for prod), and nothing is delivered until it is clicked. A topic that is ever destroyed and
created again needs its link clicked again. To change the address, overwrite the parameter
(`--overwrite`) and apply both environments.

**The orphan alarm** (`taskfest-<env>-orphan-alert`) counts the `orphanSweepAlert` lines of the
`orphans` function, with a metric filter, and goes to ALARM when an hour holds one, mailing on
entering ALARM and on returning to OK. [attachments.md](attachments.md) says when the backend writes
that line.

## The monitoring server

Gunnar's shared monitoring, VictoriaMetrics, VictoriaLogs and Perses on one Hetzner VM, lives in
[guhilling/monitoring](https://github.com/guhilling/monitoring) (private), which says how it is set
up and reached. TaskFest sends it the Go backend's logs from the environments that set
`monitoring_endpoint` in `terraform.tfvars`: qa, once it is switched on; prod not, for now.

**How they get there** (`monitoring.tf`). A CloudWatch Logs subscription filter on each of the Go
backend's log groups -- the other four functions' and the HTTP API's access log -- hands every batch of
lines to the function `taskfest-<env>-logship`, which posts them to the server's VictoriaLogs
(`/insert/jsonline`) over HTTPS, with basic auth as the user `taskfest-<env>`. CloudWatch keeps
every line as before, so nothing is lost when the server is away: Lambda retries a failed batch
twice and then drops it. logship's own log is not sent.

**What a line becomes** (`serverless/internal/logship`). Each carries `project` (`taskfest`), `env`
and `source` -- `api`, `api-access`, `streams`, `orphans`, `replay` -- which are its stream. A JSON
line keeps its fields, its `msg` becoming the message; the access log's path becomes a `route` with
its ids as `{id}`, beside `method`, `status` and `latencyMs`; Lambda's `REPORT` line becomes
`durationMs`, `billedDurationMs`, `maxMemoryUsedMB`, after a cold start `initDurationMs`, and for an
invocation that did not end well its `invocationStatus`, such as `timeout`. The
lines that only mark an invocation's start and end are left out. This is where the dashboards'
latency and error figures come from: the Go backend has no metrics endpoint.

**What leaves AWS:** the sign-in line's `user`, the OIDC subject, is personal data, which is why
the privacy texts name Hetzner for the environments that send; the ids of the tasks and attachments
some lines name go too, though not their content. The access log holds no IP address.
VictoriaLogs keeps everything for 30 days, as qa's CloudWatch does.

**Switching an environment on**, in this order, the first two by Gunnar:
1. The server answers at its name with a certificate, and its Caddy knows the sender
   (the [server page](https://github.com/guhilling/monitoring/blob/main/doc/server.md) (private)).
2. The sender's password, the same one whose hash Caddy has, as an SSM SecureString:
   ```sh
   aws ssm put-parameter --name /taskfest/<env>/monitoring-password --type SecureString \
     --value '<password>'
   ```
3. `monitoring_endpoint = "https://monitoring.cloud.hilling.de"` in the environment's
   `terraform.tfvars`, and the privacy texts naming Hetzner for it, in one pull request; then
   `env.sh up <env>` as the administrator, since the apply adds permissions and filters. Without
   the parameter the plan stops at the data source, before anything changes.
4. **A redeploy of the release that runs**, with `deploy-serverless.yml`: the apply sets logship's
   settings, which reach what serves only as a newly published version
   ([serverless.md](serverless.md#deploying-a-release)). Until then the filters invoke the version
   published without an endpoint, which logs a warning and sends nothing.

**Cost:** logship runs once per batch, a few thousand times a month at the demo's traffic, inside
Lambda's free tier; the subscription filters cost nothing; data leaving AWS is about $0.09/GB,
cents. The server is a fixed ~€6 a month, shared with other workloads (#508).
