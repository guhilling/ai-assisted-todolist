# The environment's logs, sent on to the shared monitoring server (#508, guhilling/monitoring),
# where Perses shows them beside other workloads; only where monitoring_endpoint names one, qa so
# far. CloudWatch Logs hands each batch of the functions' and the HTTP API's lines to logship
# (serverless-jobs.tf), which posts them to the server's VictoriaLogs with this environment's
# password. CloudWatch keeps every line as before: the alarms' metric filters read it, and it is the
# record when the server is away. logship's own log is not sent, so it can never feed itself.
#
# Foundation: the filters cost nothing, logship bills per batch, fractions of a cent a month at
# the demo's traffic, and sending out of AWS is about $0.09/GB, cents. The password is an SSM
# SecureString, created by hand like the alert address (doc/deployment/observability.md).

locals {
  monitoring          = var.monitoring_endpoint != ""
  monitoring_password = "/${var.project}/${var.environment}/monitoring-password"

  logship_settings = {
    TASKFEST_ENV                           = var.environment
    TASKFEST_MONITORING_ENDPOINT           = var.monitoring_endpoint
    TASKFEST_MONITORING_USER               = local.name
    TASKFEST_MONITORING_PASSWORD_PARAMETER = local.monitoring ? local.monitoring_password : ""
  }

  # What is sent: every log the Go backend writes, by the source name logship gives it.
  shipped_logs = local.monitoring ? {
    api        = aws_cloudwatch_log_group.api_function
    api-access = aws_cloudwatch_log_group.api_access
    streams    = aws_cloudwatch_log_group.job["streams"]
    orphans    = aws_cloudwatch_log_group.job["orphans"]
    replay     = aws_cloudwatch_log_group.job["replay"]
  } : {}
}

# Read without decrypting, so a parameter not yet created fails the plan rather than every batch.
data "aws_ssm_parameter" "monitoring_password" {
  count = local.monitoring ? 1 : 0

  name            = local.monitoring_password
  with_decryption = false
}

# logship: its own log, and the password. The SSM-managed key decrypts for whoever may read the
# parameter, so no KMS permission is needed.
data "aws_iam_policy_document" "job_logship" {
  statement {
    sid       = "WriteItsOwnLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.job["logship"].arn}:*"]
  }

  dynamic "statement" {
    for_each = data.aws_ssm_parameter.monitoring_password
    content {
      sid       = "ReadThePassword"
      actions   = ["ssm:GetParameter"]
      resources = [statement.value.arn]
    }
  }
}

resource "aws_lambda_permission" "logship" {
  for_each = local.shipped_logs

  statement_id  = "logs-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.job["logship"].function_name
  qualifier     = aws_lambda_alias.job["logship"].name
  principal     = "logs.amazonaws.com"
  source_arn    = "${each.value.arn}:*"
}

# An empty pattern sends every line; logship leaves out the ones that only mark a start or an end.
resource "aws_cloudwatch_log_subscription_filter" "logship" {
  for_each = local.shipped_logs

  name            = "${local.name}-logship"
  log_group_name  = each.value.name
  filter_pattern  = ""
  destination_arn = aws_lambda_alias.job["logship"].arn

  depends_on = [aws_lambda_permission.logship]
}
