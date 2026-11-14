# Observability

What watches TaskFest, as built (checked against `deployment/aws-tofu` on 2026-11-14, #558). The
Go backend serves qa and is where the watching is complete; the containers serve prod and have only
the two alarms that predate the port. The [architecture diagram](../architecture.md) draws the
Go backend's half.

**The Go backend** (qa; prod once it is cut over, #557):

- **Logs.** Each of the five functions writes to its own CloudWatch log group, and the HTTP API
  writes an access log, one line per request with its path, status and latency; JSON lines, 30 days
  in qa and 90 in prod (`serverless.tf`, `serverless-jobs.tf`).
- **Alarms**, eight per environment, on what a function-based backend shows: the API function's
  errors and throttles, the HTTP API's server errors (five in five minutes), the stream function
  falling behind, the scheduled jobs' errors, and the table's throttles. Thresholds and reasons are
  in [serverless.md](serverless.md#the-infrastructure).
- **A dashboard**, `taskfest-<env>-go-backend`, in CloudWatch: requests and their answers, time,
  errors, throttles, the stream's lag and the table. Free: the account's first three dashboards are.
- **The shared monitoring server** (#508), qa only: every log line also goes to VictoriaLogs on a
  Hetzner VM, where Perses draws latency percentiles by route, cold starts and memory from them,
  beside the lines themselves. Below: [The monitoring server](#the-monitoring-server).
- **Metrics of its own:** none. Lambda's and API Gateway's are in CloudWatch, and the logs carry the
  rest -- which is why the monitoring server's figures come from the access log and the `REPORT`
  lines.

**The containers** (prod, while it is on them):

- **Logs.** The Quarkus JSON log, one CloudWatch group per environment, 30 days in qa and 90 in
  prod. What they contain and how to query them is
  [below](#the-backends-logs-what-is-in-them-and-how-to-ask-them).
- **Alarms:** the orphan clean-up's alert, and the up-time reminder, which mails once the backend
  service has run for four hours ([below](#alerting-the-address-and-the-one-time-setup)). **Not built**, of
  the ones first planned: the load balancer's 5xx rate and target health, the service's running
  count, and the database's free storage and CPU credits. The port makes them moot: once prod is cut
  over, none of these resources runs.
- **Metrics:** the backend exposes `/q/metrics` and tests it (`MetricsResourceTest`), but nothing in
  AWS scrapes it; the plan to have the ECS agent do so was never built. The monitoring server's
  trial scraped it locally (`doc/local-development/monitoring.md`).

**For both:**

- **Alerting to** an SNS topic per environment, `taskfest-<env>-alerts`, with Gunnar's address
  subscribed by mail, and User Notifications pushing the up-time reminder to his phone
  (`alerting.tf`). Every alarm above notifies it, on entering ALARM and on returning to OK.
- **Budgets**, account-wide and made by hand in the Billing console, not in OpenTofu: one at $1.50,
  one at $15 and a last warning at $100 a month, as of 2026-11-14. The per-environment budgets
  [cost.md](cost.md) proposed were not created; with the Go backend's costs a month at a time, the
  hand-made ones are what remains to be tested against the new bill (#558).
- **Flow logs.** Every connection in and out of the VPC, accepted and rejected, delivered to a
  private S3 bucket per environment and expired after 30 days. S3 rather than CloudWatch Logs:
  half the delivery price and no delivery role. They are read when something needs explaining --
  with Athena or `aws s3 cp` -- not watched, and at demo traffic they cost cents a month.
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

**The orphan alarm** (`taskfest-<env>-orphan-alert`) counts the `orphanSweepAlert` lines of both
backends, the containers' and the Go function's, with a metric filter each, and goes to ALARM when an
hour holds one, mailing on entering ALARM and on returning to OK. [attachments.md](attachments.md)
says when the backend writes that line.

**The up-time reminder** (`taskfest-<env>-up-reminder`, #535) goes to ALARM once the backend
service has run for four full hours (`up_reminder_hours`), counted by the samples of its
CPUUtilization metric, which exists only while the service runs. It mails, and User Notifications
pushes it to the phone, on entering ALARM, and again on returning to OK after `env.sh down`. It is
a reminder, not a shutdown: taking the environment down stays a person's decision.


## The backend's logs: what is in them, and how to ask them

Log group `/ecs/taskfest-<env>`, one JSON object per line. Every line carries Quarkus' fields
(`timestamp`, `level`, `loggerName`, `message`, `threadName`, `hostName`, …) and an `mdc`
object with whatever the line adds. Reviewed against real qa traffic in #122, which found the
logs nearly empty rather than noisy: before it, nothing about requests or sign-ins was logged.

| Line | Logger | `mdc` fields |
| --- | --- | --- |
| **One per HTTP request** (except `/q/*`) | `de.hilling.taskfest.access` | `requestId`, `method`, `path`, `status`, `durationMs`, `user` and `provider` (both absent when anonymous), `app` (the mobile app's release from `X-TaskFest-App`, absent from the website, #268) |
| **Sign-in** | `de.hilling.taskfest.auth` | `event` (`signed-in`), `user`, `provider` |
| **Orphan clean-up, once a run** (hourly) | `de.hilling.taskfest.attachment.OrphanedObjects` | `orphanSweepListed`, `orphanSweepOrphans`, `orphanSweepDeleted` — counts, as strings like every `mdc` value |
| **Orphan alert**, a `WARN` only when a run finds more settled orphans than `alert-above` (2) | `de.hilling.taskfest.attachment.OrphanedObjects` | `orphanSweepAlert` (`true`): what the alarm's metric filter matches, by string equality, since `mdc` values are never numbers ([attachments.md](attachments.md)) |
| **Anything else during a request** | its own | `requestId` |
| **Start-up, migration** | `io.quarkus`, `io.quarkus.runtime.Application`, `liquibase.*` | — |

- **Every request, including the ones no REST resource sees.** The line is written by a handler
  at the very front of the HTTP router, ahead of security, once the response has ended — so a
  session OIDC turns away with a 401, a sign-in redirect, the callback and an unknown path each
  get one, with the status the client saw.
- **`requestId`** is the `Root` of the load balancer's `X-Amzn-Trace-Id`, and a fresh UUID where
  there is none (locally) or where the header does not look like the load balancer's — a client
  could send anything. Neither the ALB nor CloudFront has access logging enabled, so for now the
  id ties together this log only. It is in the MDC from the start of the request, so lines
  logged while the request is handled carry it too.
- **The health checks are not logged:** the handler leaves `/q/*` alone, which keeps the load
  balancer's checks, every few seconds per task, out of the log and out of the bill.
- **Sign-in** comes from Quarkus OIDC's security event: the authorization code flow's redirects
  never reach a REST resource. **Sign-out** is the application's own `/api/auth/logout`, which has
  no such event; its access line, which names the user, is the record, and the *Sign-ins* query
  shows both.
- **Liquibase's summary** is logged as JSON only (`LIQUIBASE_COMMAND_SHOW_SUMMARY_OUTPUT=log`, set
  in the image, so wherever it migrates); it used to appear a second time as plain text. The
  summary is an argument of Liquibase's `update` command, hence the `COMMAND_` infix: the shorter
  name used before had no effect and only made Liquibase warn about an invalid variable.

**`provider`** is the provider that signed the user in, by the id the provider list knows it by:
`google` in qa and prod, `keycloak` locally, `cognito` for qa's test accounts (#143). A `sub` is unique only within
its provider, so `user` alone is ambiguous once there is more than one.

**Personal data:** the only one is **`user`, the OpenID Connect `sub`** — a pseudonymous id the
identity provider assigns, which says nothing about the person without the provider's records.
Email addresses, names, tokens and cookies are never logged; `RequestLog` and `SignInLog` (in
`backend/src/main/java/de/hilling/taskfest/logging/`) say so where the lines are written, and
their tests pin it. Retention is the log group's: 30 days in qa, 90 in prod.

**Saved queries.** CloudWatch → *Logs Insights* → *Queries*, in the folder `taskfest-<env>`;
defined in `deployment/aws-tofu/modules/environment/ecs.tf`. Choose the time range in the
console — a saved query cannot carry one. Each run costs $0.005 per GB scanned: for this log
group, a fraction of a cent.

| Query | Answers |
| --- | --- |
| *Failures* | What failed — `FATAL`, `ERROR` and `WARN` lines (and their java.util.logging spellings), and every request answered with a 5xx |
| *Slow requests* | Which requests took longest, slowest first |
| *Start-up and migration* | Whether the last deployment or migration started cleanly — `started in …` or `Failed to start application`, and Liquibase's steps |
| *Sign-ins* | Who signed in and out, by `sub` |
| *One request* | Every line of one request: paste its `requestId` from any of the others |

**Two timestamps, and why that is fine.** An event's `@timestamp` — the one the console's time
range and every query's time window use — is set by ECS's `awslogs` log driver when it reads the
line from the container, not taken from the line's own JSON `timestamp`. The driver cannot do
otherwise: it has no option to parse a time out of the line (`awslogs-datetime-format` only marks
where a multi-line event starts). The two differ by milliseconds, since the driver reads each line
as Quarkus writes it, so a query that needs the application's own time sorts or displays it —
`fields timestamp | sort timestamp desc` — and leaves the window on `@timestamp`.

**FireLens is the option if that ever stops being true** — logs buffered, or arriving late. It
replaces the `awslogs` driver with Fluent Bit as a sidecar container in each task (AWS's own image,
`aws-for-fluent-bit`), whose JSON parser takes the event time from the line (`Time_Key timestamp`)
before shipping it to CloudWatch. The price is a second container in every task definition, its
CPU and memory out of the task's share, and a Fluent Bit configuration to maintain. Considered in
October 2026 and not taken: nothing here buffers its logs.

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
   `env.sh up` or `down` as the administrator, since the apply adds permissions and filters. Without
   the parameter the plan stops at the data source, before anything changes.
4. **A redeploy of the release that runs**, with `deploy-serverless.yml`: the apply sets logship's
   settings, which reach what serves only as a newly published version
   ([serverless.md](serverless.md#deploying-a-release)). Until then the filters invoke the version
   published without an endpoint, which logs a warning and sends nothing.

**Cost:** logship runs once per batch, a few thousand times a month at the demo's traffic, inside
Lambda's free tier; the subscription filters cost nothing; data leaving AWS is about $0.09/GB,
cents. The server is a fixed ~€6 a month, shared with other workloads (#508).
