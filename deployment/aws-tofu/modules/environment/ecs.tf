# The free half of ECS: the cluster, the log group, and the role ECS itself uses to start a task.
# The task definitions that run in it reference the database, so they are in billable.tf.
#
# Nothing long-running lives here yet. The two task families are one-off jobs, started by a
# person through env.sh: `db-bootstrap` creates the application's database user once, and
# `migrate` runs Liquibase over IAM authentication and exits. The backend service arrives with
# the load balancer.

# Container Insights stays off (Trivy's AWS-0034): it bills per metric per task, and the metrics
# that matter here -- does the one-off task exit 0 -- are in the task's own stopped state and log.
#trivy:ignore:AWS-0034
resource "aws_ecs_cluster" "this" {
  name = local.cluster_name

  setting {
    name  = "containerInsights"
    value = "disabled"
  }

  tags = { Name = local.cluster_name }
}

# AWS-0017, a customer-managed key, is suppressed for the reason the flow logs and Performance
# Insights give: about $1 a month per key, more than these logs are worth. They are encrypted
# at rest with CloudWatch's own key regardless.
#trivy:ignore:AWS-0017
resource "aws_cloudwatch_log_group" "ecs" {
  name              = "/ecs/${local.name}"
  retention_in_days = var.log_retention_days

  tags = { Name = "/ecs/${local.name}" }
}

# The role ECS uses to start a task: write its log stream, and, for the bootstrap task only,
# fetch the master credentials it injects. It is not what the container runs as -- that is the
# task role in database.tf -- and the application never sees these permissions.
data "aws_iam_policy_document" "task_execution_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:ecs:${local.region}:${local.account}:*"]
    }
  }
}

resource "aws_iam_role" "task_execution" {
  name               = local.task_execution_role
  description        = "Lets ECS start ${var.environment} tasks: their logs, and the master secret for the bootstrap task."
  assume_role_policy = data.aws_iam_policy_document.task_execution_trust.json

  tags = { Name = local.task_execution_role }
}

data "aws_iam_policy_document" "task_execution" {
  statement {
    sid = "WriteThisEnvironmentsTaskLogs"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.ecs.arn}:*"]
  }

  # The secret's name is random per instance (rds!db-<uuid>) and changes with every restore, so
  # it is matched by the tag RDS puts on it instead: the ARN of the instance it belongs to, which
  # is fixed by the instance's name. That is exactly this environment's master secret and no
  # other, without the policy having to change each time the database is recreated.
  statement {
    sid       = "ReadOnlyThisEnvironmentsMasterSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = ["arn:aws:secretsmanager:${local.region}:${local.account}:secret:rds!db-*"]

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/aws:rds:primaryDBInstanceArn"
      values   = ["arn:aws:rds:${local.region}:${local.account}:db:${local.db_instance}"]
    }
  }
}

resource "aws_iam_role_policy" "task_execution" {
  name   = local.task_execution_role
  role   = aws_iam_role.task_execution.id
  policy = data.aws_iam_policy_document.task_execution.json
}
