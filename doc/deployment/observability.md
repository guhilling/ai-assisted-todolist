# Observability

Named, because "best practices are applied" plans nothing:

- **Logs.** The Quarkus JSON log to CloudWatch Logs, one group per environment, 30-day retention
  in QA and 90 in prod. What they contain and how to query them is below.
- **Metrics.** `/q/metrics` is already exposed and already tested (`MetricsResourceTest`).
  Scraped into CloudWatch by the ECS agent's Prometheus support, so the dashboards use what the
  application already publishes rather than something invented for AWS.
- **Alarms**, each on a condition a person can act on: ALB 5xx rate; ALB target health; ECS
  service running-count below desired; RDS free storage; RDS CPU credit balance — `t4g` instances
  are burstable and exhausting credits looks exactly like a slow application.
- **Flow logs.** Every connection in and out of the VPC, accepted and rejected, delivered to a
  private S3 bucket per environment and expired after 30 days. S3 rather than CloudWatch Logs:
  half the delivery price and no delivery role. They are read when something needs explaining —
  with Athena or `aws s3 cp` — not watched, and at demo traffic they cost cents a month.
- **Traces.** Not in this plan. One service and one database do not repay X-Ray yet; when the
  commercial shape has more than one service, this is where it goes.
- **Alerting to** an SNS topic per environment, `taskfest-<env>-alerts`, with Gunnar's email
  subscribed (`alerting.tf`). Built for the orphan clean-up's alarm (#208) so far; the alarms
  above notify the same topic once they exist.

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

**The orphan alarm** (`taskfest-<env>-orphan-alert`) counts the backend's `orphanSweepAlert` lines
with a metric filter and goes to ALARM when an hour holds one, mailing on entering ALARM and on
returning to OK. [attachments.md](attachments.md) says when the backend writes that line.


## The backend's logs: what is in them, and how to ask them

Log group `/ecs/taskfest-<env>`, one JSON object per line. Every line carries Quarkus' fields
(`timestamp`, `level`, `loggerName`, `message`, `threadName`, `hostName`, …) and an `mdc`
object with whatever the line adds. Reviewed against real qa traffic in #122, which found the
logs nearly empty rather than noisy: before it, nothing about requests or sign-ins was logged.

| Line | Logger | `mdc` fields |
| --- | --- | --- |
| **One per HTTP request** (except `/q/*`) | `de.hilling.taskfest.access` | `requestId`, `method`, `path`, `status`, `durationMs`, `user` and `provider` (both absent when anonymous) |
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
