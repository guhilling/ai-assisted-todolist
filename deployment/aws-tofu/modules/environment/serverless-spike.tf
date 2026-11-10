# The serverless spike (#535): one Go Lambda function answering GET /api/tasks from one DynamoDB
# table, to measure a cold start in Frankfurt before the backend is ported
# (doc/deployment/serverless.md). Only where `serverless_spike` is true: qa.
#
# Foundation rather than billable.tf: both bill per request, not per hour, so an idle spike costs
# nothing and survives a down/up cycle. No API Gateway and no VPC: serverless/spike/measure.sh
# invokes the function directly, with the event API Gateway's JWT authorizer would send.
#
# The code is serverless/dist/tasks.zip, built by serverless/build.sh before the apply that
# creates the function; measure.sh uploads it again afterwards, so OpenTofu never tracks it.

locals {
  spike          = var.serverless_spike ? 1 : 0
  spike_name     = "${local.name}-spike"
  spike_function = "${local.name}-spike-tasks"
}

# AWS-0024 and AWS-0025, point-in-time recovery and a customer-managed key: the table holds
# twenty made-up tasks of a test account, and recovery would cost $0.2448 per GB-month for data
# that measure.sh writes again on every run. It is encrypted with DynamoDB's own key regardless.
#trivy:ignore:AWS-0024
#trivy:ignore:AWS-0025
resource "aws_dynamodb_table" "spike" {
  count = local.spike

  name         = local.spike_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  tags = { Name = local.spike_name }
}

# AWS-0017, as for the backend's log group (ecs.tf).
#trivy:ignore:AWS-0017
resource "aws_cloudwatch_log_group" "spike" {
  count = local.spike

  name              = "/aws/lambda/${local.spike_function}"
  retention_in_days = var.log_retention_days

  tags = { Name = "/aws/lambda/${local.spike_function}" }
}

data "aws_iam_policy_document" "spike_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "spike" {
  count = local.spike

  name               = local.spike_function
  assume_role_policy = data.aws_iam_policy_document.spike_assume.json

  tags = { Name = local.spike_function }
}

# Reading its own table and writing its own log group, nothing else.
data "aws_iam_policy_document" "spike" {
  count = local.spike

  statement {
    sid       = "QueryTheSpikeTable"
    actions   = ["dynamodb:Query"]
    resources = [aws_dynamodb_table.spike[0].arn]
  }

  statement {
    sid       = "WriteItsOwnLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.spike[0].arn}:*"]
  }
}

resource "aws_iam_role_policy" "spike" {
  count = local.spike

  name   = local.spike_function
  role   = aws_iam_role.spike[0].id
  policy = data.aws_iam_policy_document.spike[0].json
}

# AWS-0066, X-Ray tracing: the spike measures its start with Lambda's own REPORT lines, and
# tracing would add its own start-up to what is measured.
#trivy:ignore:AWS-0066
resource "aws_lambda_function" "spike" {
  count = local.spike

  function_name = local.spike_function
  role          = aws_iam_role.spike[0].arn
  runtime       = "provided.al2023"
  handler       = "bootstrap"
  architectures = ["arm64"]
  memory_size   = 512
  timeout       = 10
  filename      = "${path.module}/../../../../serverless/dist/tasks.zip"

  environment {
    variables = { TABLE_NAME = aws_dynamodb_table.spike[0].name }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.spike[0].name
  }

  # measure.sh uploads the code and changes the memory and the variables to force cold starts.
  lifecycle {
    ignore_changes = [filename, source_code_hash, memory_size, environment]
  }

  tags = { Name = local.spike_function }

  depends_on = [aws_iam_role_policy.spike]
}
