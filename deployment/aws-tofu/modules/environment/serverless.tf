# The Go backend (#547, #554): its DynamoDB table, its function, and the HTTP API that CloudFront
# sends /api/* to once `api_backend` says so (edge.tf). doc/deployment/serverless.md has the design.
#
# Foundation rather than billable.tf: everything here bills per request, nothing by the hour, so an
# idle environment costs nothing for it and `env.sh down` leaves it alone. The table is people's
# data, as the attachment bucket is.
#
# The code is serverless/dist/api.zip, built by serverless/build.sh before the apply that creates
# the function. OpenTofu creates the function with it once and never tracks it after that: a
# release deploys its own code (#555).

locals {
  # A restored table has a name of its own, which the switch to it sets (serverless.md).
  table         = var.table_name != "" ? var.table_name : "${local.name}-data"
  api_function  = "${local.name}-api"
  api_gateway   = "${local.name}-api"
  dist          = "${path.module}/../../../../serverless/dist"
  origin_header = "X-Origin-Verify" # lambdahttp.OriginHeader

  # The Go backend's part of the shared attachment bucket (#578), files.Root: its functions may
  # touch objects there and nowhere else, so the containers' files and records are out of reach.
  # ListBucket stays on the whole bucket, without which a HEAD on a missing object answers 403.
  go_files   = "${aws_s3_bucket.attachments.arn}/serverless/attachments/*"
  go_records = "${aws_s3_bucket.attachments.arn}/serverless/deleted-accounts/*"

  # Where the data is, for every function that touches it (here and serverless-jobs.tf).
  bucket_settings  = { TASKFEST_ATTACHMENTS_BUCKET = aws_s3_bucket.attachments.bucket }
  storage_settings = merge({ TABLE_NAME = aws_dynamodb_table.data.name }, local.bucket_settings)

  # The providers the function offers, the main one first, as auth.LoadConfig reads them. As for
  # the containers, sign-in is on only where Google is: the test accounts are a provider beside
  # it, whose client allows only its own callback, never the main one.
  api_providers = local.sign_in_enabled ? concat(["google"], var.test_sign_in ? ["cognito"] : []) : []
}

# AWS-0024, point-in-time recovery, is a variable: on in prod, off in qa, which restores from an
# on-demand backup when it must (#553). AWS-0025, a customer-managed key: about $1 a month, more
# than the table; DynamoDB encrypts it with its own key regardless.
#trivy:ignore:AWS-0024
#trivy:ignore:AWS-0025
resource "aws_dynamodb_table" "data" {
  name         = local.table
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

  # Sessions, sign-ins under way and the links to sessions delete themselves (#549, #553). TTL
  # deletes late, so the backend checks the times itself as well.
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  # What a deleted item held, for the stream function that deletes an attachment's file (#551).
  stream_enabled   = true
  stream_view_type = "OLD_IMAGE"

  # A restore is how a mistake is undone, and the deletion replay keeps it lawful (#553). Billed by
  # the GB-month of data, fractions of a cent at this size.
  point_in_time_recovery {
    enabled = var.table_point_in_time_recovery
  }

  # A destroy of the foundation must not take people's data with it by accident.
  deletion_protection_enabled = true

  tags = { Name = local.table }
}

# The secret CloudFront sends with every request, so the function can refuse the rest
# (lambdahttp.FromOrigin). In state and in the function's settings, which is enough for what it
# guards: a Secrets Manager secret would cost $0.40 a month to prove only where a request came from.
resource "random_password" "origin" {
  length  = 48
  special = false
}

# AWS-0017, as for the backend's log group (ecs.tf).
#trivy:ignore:AWS-0017
resource "aws_cloudwatch_log_group" "api_function" {
  name              = "/aws/lambda/${local.api_function}"
  retention_in_days = var.log_retention_days

  tags = { Name = "/aws/lambda/${local.api_function}" }
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api_function" {
  name               = local.api_function
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json

  tags = { Name = local.api_function }
}

# Its own table, bucket, secret and log group, nothing else.
data "aws_iam_policy_document" "api_function" {
  statement {
    sid = "ReadAndWriteItsTable"
    actions = [
      "dynamodb:BatchWriteItem",
      "dynamodb:ConditionCheckItem",
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Query",
      "dynamodb:UpdateItem",
    ]
    resources = [aws_dynamodb_table.data.arn]
  }

  # TransactWriteItems is authorised per item, by the actions above; it has no action of its own.

  # As for the container's role (attachments.tf): ListBucket also makes S3 answer a HEAD on a
  # missing object with 404 rather than 403.
  statement {
    sid       = "ReadWriteAndDeleteAttachmentsAndRecords"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = [local.go_files, local.go_records]
  }

  statement {
    sid       = "TellMissingFromForbidden"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.attachments.arn]
  }

  statement {
    sid       = "ReadTheGoogleClientSecretAtAColdStart"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.google_client_secret.arn]
  }

  statement {
    sid       = "WriteItsOwnLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.api_function.arn}:*"]
  }
}

resource "aws_iam_role_policy" "api_function" {
  name   = local.api_function
  role   = aws_iam_role.api_function.id
  policy = data.aws_iam_policy_document.api_function.json
}

# AWS-0066, X-Ray tracing: the request log and Lambda's own REPORT lines say what a request did and
# how long it took; tracing would add its own start-up to every cold start.
#trivy:ignore:AWS-0066
resource "aws_lambda_function" "api" {
  function_name = local.api_function
  role          = aws_iam_role.api_function.arn
  runtime       = "provided.al2023"
  handler       = "bootstrap"
  architectures = ["arm64"]
  memory_size   = 512
  # Under the HTTP API's own 30 seconds, so a slow request ends in the function's log rather than
  # as a bare 503. Ordinary requests take milliseconds; deleting a large account takes longest.
  timeout  = 28
  filename = "${local.dist}/api.zip"

  environment {
    variables = merge(local.storage_settings, {
      TASKFEST_ORIGIN_SECRET  = random_password.origin.result
      TASKFEST_PUBLIC_ORIGIN  = "https://${var.hostname}"
      TASKFEST_AUTH_ENABLED   = tostring(local.sign_in_enabled)
      TASKFEST_AUTH_PROVIDERS = join(",", local.api_providers)
      }, local.sign_in_enabled ? {
      TASKFEST_OIDC_GOOGLE_LABEL             = "Google"
      TASKFEST_OIDC_GOOGLE_ISSUER            = "https://accounts.google.com"
      TASKFEST_OIDC_GOOGLE_CLIENT_ID         = var.google_client_id
      TASKFEST_OIDC_GOOGLE_CLIENT_SECRET_ARN = aws_secretsmanager_secret.google_client_secret.arn
      # The iOS app's own client, whose ID tokens are accepted beside the web client's (#280).
      TASKFEST_OIDC_GOOGLE_AUDIENCES = var.google_ios_client_id
      } : {}, local.sign_in_enabled && var.test_sign_in ? {
      # The test accounts (test-sign-in.tf). The client's secret is in state already (D4 on #141),
      # so a setting here shows it to no one who could not read it there; like the origin secret.
      TASKFEST_OIDC_COGNITO_LABEL         = "TaskFest test account"
      TASKFEST_OIDC_COGNITO_ISSUER        = "https://${aws_cognito_user_pool.test_accounts[0].endpoint}"
      TASKFEST_OIDC_COGNITO_CLIENT_ID     = aws_cognito_user_pool_client.backend[0].id
      TASKFEST_OIDC_COGNITO_CLIENT_SECRET = aws_cognito_user_pool_client.backend[0].client_secret
      # The mobile app's public client, whose ID tokens are accepted as bearer tokens (#267).
      TASKFEST_OIDC_COGNITO_AUDIENCES = aws_cognito_user_pool_client.app[0].id
    } : {})
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.api_function.name
  }

  # A release deploys the code (#555); OpenTofu only starts the function with what build.sh made.
  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = { Name = local.api_function }

  depends_on = [aws_iam_role_policy.api_function]
}

# AWS-0017, as above.
#trivy:ignore:AWS-0017
resource "aws_cloudwatch_log_group" "api_access" {
  name              = "/aws/apigateway/${local.api_gateway}"
  retention_in_days = var.log_retention_days

  tags = { Name = "/aws/apigateway/${local.api_gateway}" }
}

# The HTTP API: the cheapest way to give a function an HTTPS address CloudFront can use, at $1 per
# million requests. Its address is public; the function refuses whatever lacks CloudFront's header.
resource "aws_apigatewayv2_api" "this" {
  name          = local.api_gateway
  protocol_type = "HTTP"

  tags = { Name = local.api_gateway }
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

# Every path and method to the function, which routes them itself (api.Routes).
resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.this.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  # A ceiling on what a flood of requests can cost, far above what the demo's people send.
  default_route_settings {
    throttling_rate_limit  = 50
    throttling_burst_limit = 100
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_access.arn
    format = jsonencode({
      requestId = "$context.requestId"
      time      = "$context.requestTime"
      method    = "$context.httpMethod"
      path      = "$context.path"
      status    = "$context.status"
      latency   = "$context.responseLatency"
      error     = "$context.integrationErrorMessage"
    })
  }

  tags = { Name = local.api_gateway }
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowTheHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}
