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
- **Alerting to** an SNS topic per environment with Gunnar's email subscribed.


## The backend's logs: what is in them, and how to ask them

Log group `/ecs/taskfest-<env>`, one JSON object per line. Every line carries Quarkus' fields
(`timestamp`, `level`, `loggerName`, `message`, `threadName`, `hostName`, …) and an `mdc`
object with whatever the line adds. Reviewed against real qa traffic in #122, which found the
logs nearly empty rather than noisy: before it, nothing about requests or sign-ins was logged.

| Line | Logger | `mdc` fields |
| --- | --- | --- |
| **One per API request** | `de.hilling.taskfest.access` | `requestId`, `method`, `path`, `status`, `durationMs`, `user` (absent when anonymous) |
| **Sign-in / sign-out** | `de.hilling.taskfest.auth` | `event` (`signed-in`, `signed-out`), `user` |
| **Anything else during a request** | its own | `requestId` |
| **Start-up, migration** | `io.quarkus`, `io.quarkus.runtime.Application`, `liquibase.*` | — |

- **`requestId`** is the load balancer's `X-Amzn-Trace-Id` — the same id the ALB logs — and a
  fresh UUID where there is none, as locally. It is set for the whole request, so one id finds
  every line a request caused.
- **The health checks are not logged.** `/q/health` and `/q/metrics` are not REST resources and
  never reach the request filter; filtering at the source keeps the load balancer's checks, every
  few seconds per task, out of the log and out of the bill.
- **Sign-in and sign-out** come from Quarkus OIDC's security events: the redirects of the
  authorization code flow never reach a REST resource, so nothing else could see them.
- **Liquibase's summary** is logged as JSON only (`LIQUIBASE_SHOW_SUMMARY_OUTPUT=log` on the
  `migrate` task); it used to appear a second time as plain text.

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
| *Failures* | What failed — `ERROR` and `WARN` lines, and every request answered with a 5xx |
| *Slow requests* | Which requests took longest, slowest first |
| *Start-up and migration* | Whether the last deployment or migration started cleanly — `started in …` or `Failed to start application`, and Liquibase's steps |
| *Sign-ins* | Who signed in and out, by `sub` |
| *One request* | Every line of one request: paste its `requestId` from any of the others |
