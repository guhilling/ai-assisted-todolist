# Observability

Named, because "best practices are applied" plans nothing:

- **Logs.** The Quarkus JSON log to CloudWatch Logs, one group per environment, 30-day retention
  in QA and 90 in prod. The backend already logs structured output.
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

