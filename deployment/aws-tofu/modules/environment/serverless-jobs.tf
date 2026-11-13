# The Go backend's background functions (#554), beside the API in serverless.tf: `streams`, which
# follows the table's stream and deletes the files of attachments that go (#552); `orphans`, the
# hourly clean-up of files no attachment refers to (#208, #552); and `replay`, which deletes again
# any account a restore brought back and prunes the deletion records (#553). And the alarms on all
# of them, which mail through the topic in alerting.tf.
#
# Foundation, like serverless.tf: the functions bill per run, nothing by the hour; the alarms cost
# $0.10 a month each, whether the environment is up or not. The code comes from
# serverless/dist/<command>.zip as for the API.

locals {
  streams_function = "${local.name}-streams"
  orphans_function = "${local.name}-orphans"
  replay_function  = "${local.name}-replay"
  scheduler_role   = "${local.name}-scheduler"

  jobs = {
    streams = { name = local.streams_function, timeout = 60, settings = local.bucket_settings }
    # Lists the bucket and reads the table's attachment items: seconds at the demo's sizes.
    orphans = { name = local.orphans_function, timeout = 300, settings = local.storage_settings }
    # Lambda's longest, since one run may delete several restored accounts.
    replay = { name = local.replay_function, timeout = 900, settings = local.storage_settings }
  }

  # When the scheduled ones run, in Berlin time: the orphan clean-up hourly, as the Quarkus
  # backend ran it; the replay daily, at night.
  schedules = {
    orphans = "rate(1 hour)"
    replay  = "cron(30 3 * * ? *)"
  }

  # Each function's role, one policy each (below).
  job_policies = {
    streams = data.aws_iam_policy_document.job_streams.json
    orphans = data.aws_iam_policy_document.job_orphans.json
    replay  = data.aws_iam_policy_document.job_replay.json
  }
}

# AWS-0017, as for the backend's log group (ecs.tf).
#trivy:ignore:AWS-0017
resource "aws_cloudwatch_log_group" "job" {
  for_each = local.jobs

  name              = "/aws/lambda/${each.value.name}"
  retention_in_days = var.log_retention_days

  tags = { Name = "/aws/lambda/${each.value.name}" }
}

resource "aws_iam_role" "job" {
  for_each = local.jobs

  name               = each.value.name
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json

  tags = { Name = each.value.name }
}

# streams: read the stream, delete the files. Deleting a file already gone is no error, so it needs
# no ListBucket.
data "aws_iam_policy_document" "job_streams" {
  statement {
    sid       = "ReadTheTablesStream"
    actions   = ["dynamodb:DescribeStream", "dynamodb:GetRecords", "dynamodb:GetShardIterator", "dynamodb:ListStreams"]
    resources = [aws_dynamodb_table.data.stream_arn]
  }

  statement {
    sid       = "DeleteFiles"
    actions   = ["s3:DeleteObject"]
    resources = [local.go_files]
  }

  statement {
    sid       = "WriteItsOwnLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.job["streams"].arn}:*"]
  }
}

# orphans: read every attachment item, and one again before calling its file missing
# (store.Inventory); list the bucket, look at and delete objects. ListBucket also makes S3 answer a
# HEAD on a missing object with 404 rather than 403.
data "aws_iam_policy_document" "job_orphans" {
  statement {
    sid       = "ReadTheAttachmentItems"
    actions   = ["dynamodb:Scan", "dynamodb:GetItem"]
    resources = [aws_dynamodb_table.data.arn]
  }

  statement {
    sid       = "ListTheBucket"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.attachments.arn]
  }

  statement {
    sid       = "LookAtAndDeleteObjects"
    actions   = ["s3:GetObject", "s3:DeleteObject"]
    resources = [local.go_files]
  }

  statement {
    sid       = "WriteItsOwnLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.job["orphans"].arn}:*"]
  }
}

# replay: the account deletion's own reads and writes (store.Accounts); every table's recovery
# window and backups, settings only, since the oldest restore point in the region decides how long
# a record is kept (store.RestorePoints); and the deletion records, which it reads and deletes, as
# it deletes the files of the attachments it deletes. It writes no object.
data "aws_iam_policy_document" "job_replay" {
  statement {
    sid = "DeleteAccountsAgain"
    actions = [
      "dynamodb:BatchWriteItem",
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Query",
      "dynamodb:UpdateItem",
    ]
    resources = [aws_dynamodb_table.data.arn]
  }

  # ListTables and ListBackups take no resource.
  statement {
    sid       = "ListTheTablesAndBackups"
    actions   = ["dynamodb:ListTables", "dynamodb:ListBackups"]
    resources = ["*"]
  }

  statement {
    sid       = "ReadEveryTablesRecoveryWindow"
    actions   = ["dynamodb:DescribeContinuousBackups"]
    resources = ["arn:aws:dynamodb:${local.region}:${data.aws_caller_identity.current.account_id}:table/*"]
  }

  statement {
    sid       = "ListTheBucket"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.attachments.arn]
  }

  statement {
    sid       = "LookAtTheDeletionRecords"
    actions   = ["s3:GetObject"]
    resources = [local.go_records]
  }

  statement {
    sid       = "DeleteRecordsAndFiles"
    actions   = ["s3:DeleteObject"]
    resources = [local.go_files, local.go_records]
  }

  statement {
    sid       = "WriteItsOwnLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.job["replay"].arn}:*"]
  }
}

resource "aws_iam_role_policy" "job" {
  for_each = local.jobs

  name   = each.value.name
  role   = aws_iam_role.job[each.key].id
  policy = local.job_policies[each.key]
}

# AWS-0066, X-Ray tracing: as for the API (serverless.tf); each run logs what it did.
#trivy:ignore:AWS-0066
resource "aws_lambda_function" "job" {
  for_each = local.jobs

  function_name = each.value.name
  role          = aws_iam_role.job[each.key].arn
  runtime       = "provided.al2023"
  handler       = "bootstrap"
  architectures = ["arm64"]
  memory_size   = 512
  timeout       = each.value.timeout
  filename      = "${local.dist}/${each.key}.zip"

  environment {
    variables = each.value.settings
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.job[each.key].name
  }

  # A release deploys the code (#555), as for the API.
  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = { Name = each.value.name }

  depends_on = [aws_iam_role_policy.job]
}

# The version of each that runs, as for the API (serverless.tf): the stream and the schedules invoke
# the alias, which a release's deploy moves.
resource "aws_lambda_alias" "job" {
  for_each = local.jobs

  name             = local.live_alias
  function_name    = aws_lambda_function.job[each.key].function_name
  function_version = "$LATEST"

  lifecycle {
    ignore_changes = [function_version]
  }
}

# The stream, filtered to the removals of attachment items, the only records `streams` acts on, so
# no other write invokes it. A failed record holds its shard and is sent again, so the retries are
# capped: what is given up on, the orphan clean-up deletes after seven days -- unless it was the
# last file attachment in the table, since the clean-up deletes nothing from a table without one
# (orphans.HoldNoAttachments); those files wait until there is one again.
resource "aws_lambda_event_source_mapping" "streams" {
  event_source_arn = aws_dynamodb_table.data.stream_arn
  function_name    = aws_lambda_alias.job["streams"].arn
  # The oldest record still in the stream, so no removal written before the mapping began is
  # missed; one deleted twice is no error.
  starting_position              = "TRIM_HORIZON"
  batch_size                     = 100
  maximum_retry_attempts         = 5
  maximum_record_age_in_seconds  = 3600
  bisect_batch_on_function_error = true
  function_response_types        = ["ReportBatchItemFailures"]

  filter_criteria {
    filter {
      pattern = jsonencode({
        eventName = ["REMOVE"]
        dynamodb  = { Keys = { SK = { S = [{ prefix = "ATT#" }] } } }
      })
    }
  }
}

# A run that fails is not tried again: the next hour's or day's run does the same work.
resource "aws_lambda_function_event_invoke_config" "scheduled" {
  for_each = local.schedules

  function_name          = aws_lambda_function.job[each.key].function_name
  qualifier              = aws_lambda_alias.job[each.key].name
  maximum_retry_attempts = 0
}

data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = local.scheduler_role
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json

  tags = { Name = local.scheduler_role }
}

data "aws_iam_policy_document" "scheduler" {
  statement {
    sid       = "StartTheScheduledFunctions"
    actions   = ["lambda:InvokeFunction"]
    resources = [for job in keys(local.schedules) : aws_lambda_alias.job[job].arn]
  }
}

resource "aws_iam_role_policy" "scheduler" {
  name   = local.scheduler_role
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler.json
}

# EventBridge Scheduler: free for the first 14 million runs a month, which two schedules never
# reach.
resource "aws_scheduler_schedule" "job" {
  for_each = local.schedules

  name                         = "${local.name}-${each.key}"
  schedule_expression          = each.value
  schedule_expression_timezone = "Europe/Berlin"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_alias.job[each.key].arn
    role_arn = aws_iam_role.scheduler.arn

    # The function is not tried again either (above).
    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}

# The Go orphan clean-up's alert line feeds the same metric as the containers' (alerting.tf), so
# the one alarm sees both. Its log lines are JSON, the field a boolean.
resource "aws_cloudwatch_log_metric_filter" "orphan_alert_serverless" {
  name           = "${local.name}-orphan-alert-serverless"
  log_group_name = aws_cloudwatch_log_group.job["orphans"].name
  pattern        = "{ $.orphanSweepAlert IS TRUE }"

  metric_transformation {
    name          = local.orphan_alert_metric
    namespace     = local.alerting_namespace
    value         = "1"
    default_value = "0"
  }
}

# The alarms, each $0.10 a month: one per thing that can go wrong unnoticed. Each mails once on
# entering ALARM and once on leaving it. No data, as with no traffic, is no alarm. Not the HTTP
# API's 5xx answers yet: they were left out while unported routes answered 501 on purpose, and a
# crash or a timeout already shows as the function's error; #558 adds them.
locals {
  serverless_alarms = {
    api-errors = {
      description = "The ${var.environment} API function failed: a crash or a timeout, not an error response."
      namespace   = "AWS/Lambda", metric = "Errors", dimensions = { FunctionName = local.api_function }
    }
    api-throttles = {
      description = "The ${var.environment} API function was throttled: requests were turned away."
      namespace   = "AWS/Lambda", metric = "Throttles", dimensions = { FunctionName = local.api_function }
    }
    # A record whose files fail to go is reported, not raised, so the function's errors never see
    # it; the stream falling behind does, ten minutes before the hour after which it gives up.
    streams-behind = {
      description = "The ${var.environment} stream function is more than ten minutes behind: it keeps failing to delete the files of deleted attachments, and gives up on them after an hour, leaving them to the orphan clean-up."
      namespace   = "AWS/Lambda", metric = "IteratorAge", dimensions = { FunctionName = local.streams_function }
      statistic   = "Maximum", threshold = 600000
    }
    orphans-errors = {
      description = "The ${var.environment} orphan clean-up failed; the next hour's run tries again."
      namespace   = "AWS/Lambda", metric = "Errors", dimensions = { FunctionName = local.orphans_function }
    }
    replay-errors = {
      description = "The ${var.environment} deletion replay failed: an account a restore brought back may still be there (doc/deployment/serverless.md, The replay)."
      namespace   = "AWS/Lambda", metric = "Errors", dimensions = { FunctionName = local.replay_function }
    }
    table-read-throttles = {
      description = "The ${var.environment} table throttled reads."
      namespace   = "AWS/DynamoDB", metric = "ReadThrottleEvents", dimensions = { TableName = local.table }
    }
    table-write-throttles = {
      description = "The ${var.environment} table throttled writes."
      namespace   = "AWS/DynamoDB", metric = "WriteThrottleEvents", dimensions = { TableName = local.table }
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "serverless" {
  for_each = local.serverless_alarms

  alarm_name          = "${local.name}-${each.key}"
  alarm_description   = each.value.description
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  dimensions          = each.value.dimensions
  statistic           = lookup(each.value, "statistic", "Sum")
  period              = 300
  evaluation_periods  = 1
  threshold           = lookup(each.value, "threshold", 1)
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  tags = { Name = "${local.name}-${each.key}" }
}
