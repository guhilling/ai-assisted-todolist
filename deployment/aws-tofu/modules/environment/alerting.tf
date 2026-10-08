# Alerting (#208): a mail to Gunnar when the orphan clean-up finds more than two orphaned files,
# which is what a database restored from an older snapshot, or started empty, looks like -- days
# before the clean-up would delete them (doc/deployment/attachments.md).
#
# The chain: the backend writes a WARN line with mdc.orphanSweepAlert = "true" when a run crosses
# its threshold; a metric filter counts those lines; an alarm on the count notifies an SNS topic;
# the topic mails the address subscribed to it. The threshold lives in the backend
# (taskfest.attachments.orphan-sweep.alert-above), because mdc values are strings, which a filter
# can match by equality but not compare as numbers.
#
# The address is not in this repository: Gunnar keeps it in an SSM parameter, created once by hand
# (doc/deployment/observability.md says how), and this reads it. A standard String parameter is
# free; an email address is not a secret, so Secrets Manager would cost $0.40 a month for nothing.
#
# Foundation rather than billable.tf, like the log group it watches: a restore happens on `up`,
# and the alarm must already be there to see it. The topic is the one future alarms (the ones
# observability.md plans) will notify too.

locals {
  alerts_topic        = "${local.name}-alerts"
  alert_email_param   = "/taskfest/alert-email"
  orphan_alert_metric = "OrphanSweepAlerts"
  alerting_namespace  = "TaskFest/${var.environment}"
}

data "aws_ssm_parameter" "alert_email" {
  name = local.alert_email_param
}

# AWS-0095, encryption: CloudWatch alarms cannot publish to a topic encrypted with the AWS-managed
# SNS key, and a customer-managed key costs a dollar a month to protect alarm notifications that
# carry no personal data.
#trivy:ignore:AWS-0095
resource "aws_sns_topic" "alerts" {
  name = local.alerts_topic

  tags = { Name = local.alerts_topic }
}

# Email subscriptions start pending: AWS mails the address, and nothing is delivered until the
# link in that mail is clicked. Tofu shows the subscription as created either way.
resource "aws_sns_topic_subscription" "alert_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = data.aws_ssm_parameter.alert_email.value
}

resource "aws_cloudwatch_log_metric_filter" "orphan_alert" {
  name           = "${local.name}-orphan-alert"
  log_group_name = aws_cloudwatch_log_group.ecs.name
  pattern        = "{ $.mdc.orphanSweepAlert = \"true\" }"

  metric_transformation {
    name          = local.orphan_alert_metric
    namespace     = local.alerting_namespace
    value         = "1"
    default_value = "0"
  }
}

# Any alert line within an hour -- one run's worth -- raises the alarm; it mails once on entering
# ALARM and once on going back to OK, not every hour in between. No data, as on an environment
# that is down, is not an alert.
resource "aws_cloudwatch_metric_alarm" "orphan_alert" {
  alarm_name          = "${local.name}-orphan-alert"
  alarm_description   = "The ${var.environment} orphan clean-up found more than two orphaned attachment files. A database restored from an older snapshot, or started empty, looks like this; orphans are deleted after seven days (doc/deployment/attachments.md)."
  namespace           = local.alerting_namespace
  metric_name         = local.orphan_alert_metric
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  tags = { Name = "${local.name}-orphan-alert" }
}
