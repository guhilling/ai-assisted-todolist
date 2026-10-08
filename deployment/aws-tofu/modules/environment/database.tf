# The free half of the database: where it lives and who it is for. The instance itself bills and
# is in billable.tf, behind the teardown switch; everything here survives `env.sh down`.
#
# The application logs in with IAM database authentication, not a password. Its identity is the
# ECS task role below, which may connect as one database user and nothing else; the token it
# signs per connection is checked by RDS against IAM. The master password exists only for
# bootstrapping and administration, is generated and kept by RDS in Secrets Manager, and never
# reaches the running service -- see doc/deployment/database.md.

locals {
  # Per environment, so that the IAM grant can name the user rather than the instance: an
  # instance's resource id changes with every restore from snapshot, and a grant on it would
  # have to be re-applied after every `up`. With the user in the grant, qa's task role cannot
  # log in as prod's user even if it could reach prod's database.
  db_app_user = "${var.project}_${var.environment}"

  db_name   = var.project
  db_engine = "postgres"

  # Major version only: RDS picks the newest minor and auto_minor_version_upgrade keeps it
  # current, where a pinned minor would show as drift after every upgrade. 18 matches Dev
  # Services and the Compose stacks, which .github/scripts/check-postgres-version.py enforces.
  db_engine_major = "18"
}

resource "aws_db_subnet_group" "this" {
  name        = local.db_subnet_group
  description = "The private subnets: no route out, reachable only from inside the VPC"
  subnet_ids  = aws_subnet.private[*].id

  tags = { Name = local.db_subnet_group }
}

# The identity the backend container runs as. Created here rather than with the ECS service
# because the database grant is the first thing it needs; the deploy and lifecycle roles already
# name it as the only task role they may pass, so its name comes from deploy.tf.
data "aws_iam_policy_document" "task_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    # Only ECS acting for this account: without these, any account's ECS could be told to
    # assume the role -- the confused-deputy case.
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

resource "aws_iam_role" "task" {
  name               = local.task_role
  description        = "What the ${var.environment} backend container runs as. May log in to its own database user."
  assume_role_policy = data.aws_iam_policy_document.task_trust.json

  tags = { Name = local.task_role }
}

# The whole of the database credential. `*` is the instance's resource id, which changes on
# every restore; the user name is what pins it to this environment.
data "aws_iam_policy_document" "task" {
  statement {
    sid       = "LogInAsThisEnvironmentsDatabaseUser"
    actions   = ["rds-db:connect"]
    resources = ["arn:aws:rds-db:${local.region}:${local.account}:dbuser:*/${local.db_app_user}"]
  }

  # Account deletion records (#213) are kept while a snapshot older than the deletion exists, so the
  # backend lists its instance's snapshots and retained backups. Metadata only, never their
  # content. On "*" because these Describe calls do not reliably honour a resource ARN; the call
  # names the instance, and a failure only keeps every record.
  statement {
    sid = "ListThisDatabasesRestorablePoints"
    actions = [
      "rds:DescribeDBSnapshots",
      "rds:DescribeDBInstanceAutomatedBackups",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = local.task_role
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}
