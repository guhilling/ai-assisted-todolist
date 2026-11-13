# The Go backend's dashboard (#558): what to watch once it serves -- requests and their answers,
# the API function's time and throttles, the jobs, and the table. One per environment, named after
# it. Foundation like the rest of serverless.tf: free, since CloudWatch includes three dashboards
# per account, and the account had one before these two (doc/deployment/cost.md).

locals {
  # Every widget is a line over the last three hours, in this region, five minutes a point.
  dashboard_defaults = { view = "timeSeries", region = local.region, period = 300, stacked = false }
  api_dimensions     = ["ApiId", aws_apigatewayv2_api.this.id, "Stage", "$default"]

  dashboard_widgets = [
    { title = "Requests and their answers (HTTP API)", metrics = [
      concat(["AWS/ApiGateway", "Count"], local.api_dimensions, [{ stat = "Sum", label = "Requests" }]),
      concat(["AWS/ApiGateway", "4xx"], local.api_dimensions, [{ stat = "Sum", label = "4xx" }]),
      concat(["AWS/ApiGateway", "5xx"], local.api_dimensions, [{ stat = "Sum", label = "5xx" }]),
    ] },
    { title = "Time to answer (HTTP API, ms)", metrics = [
      concat(["AWS/ApiGateway", "Latency"], local.api_dimensions, [{ stat = "p50", label = "Median" }]),
      concat(["AWS/ApiGateway", "Latency"], local.api_dimensions, [{ stat = "p95", label = "95th percentile" }]),
    ] },
    # A cold start shows as the duration's maximum, its typical answer as the median.
    { title = "API function (ms, and counts)", metrics = [
      ["AWS/Lambda", "Duration", "FunctionName", local.api_function, { stat = "p50", label = "Duration, median" }],
      ["AWS/Lambda", "Duration", "FunctionName", local.api_function, { stat = "Maximum", label = "Duration, longest" }],
      ["AWS/Lambda", "Errors", "FunctionName", local.api_function, { stat = "Sum", label = "Errors" }],
      ["AWS/Lambda", "Throttles", "FunctionName", local.api_function, { stat = "Sum", label = "Throttles" }],
    ] },
    { title = "Jobs (runs and errors)", metrics = concat(
      [for job in ["streams", "orphans", "replay"] :
      ["AWS/Lambda", "Invocations", "FunctionName", local.jobs[job].name, { stat = "Sum", label = "${job}, runs" }]],
      [for job in ["streams", "orphans", "replay"] :
      ["AWS/Lambda", "Errors", "FunctionName", local.jobs[job].name, { stat = "Sum", label = "${job}, errors" }]],
    ) },
    { title = "Stream function behind (ms)", metrics = [
      ["AWS/Lambda", "IteratorAge", "FunctionName", local.streams_function, { stat = "Maximum", label = "Behind, longest" }],
    ] },
    { title = "Table (capacity used, throttles)", metrics = [
      ["AWS/DynamoDB", "ConsumedReadCapacityUnits", "TableName", local.table, { stat = "Sum", label = "Reads" }],
      ["AWS/DynamoDB", "ConsumedWriteCapacityUnits", "TableName", local.table, { stat = "Sum", label = "Writes" }],
      ["AWS/DynamoDB", "ReadThrottleEvents", "TableName", local.table, { stat = "Sum", label = "Throttled reads" }],
      ["AWS/DynamoDB", "WriteThrottleEvents", "TableName", local.table, { stat = "Sum", label = "Throttled writes" }],
    ] },
  ]
}

resource "aws_cloudwatch_dashboard" "serverless" {
  dashboard_name = "${local.name}-go-backend"
  dashboard_body = jsonencode({
    widgets = [
      for index, widget in local.dashboard_widgets : {
        type       = "metric"
        x          = (index % 2) * 12
        y          = floor(index / 2) * 6
        width      = 12
        height     = 6
        properties = merge(local.dashboard_defaults, { title = widget.title, metrics = widget.metrics })
      }
    ]
  })
}
