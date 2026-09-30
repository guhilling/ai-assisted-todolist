# The identity GitHub Actions deploys this environment with.
#
# It is a role assumed through OIDC, not a user with an access key: a workflow job trades a
# signed token describing itself for credentials that expire in minutes, so there is no secret
# in GitHub to leak and nothing to rotate. The account root creates the trusted issuer.
#
# The scope is deliberately "redeploy the application", not "manage the environment". The VPC,
# the database, the load balancer and the cluster are created by a human with their own
# privileges, and this role cannot touch any of them. That split is not a matter of degree: a
# role that could run `tofu apply` would need create and delete on everything this module
# manages, which is administrator for the environment under a different name. Not creating such
# a credential at all is stronger than trying to constrain one.

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

# Created by the account root, which must be applied first.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

locals {
  account = data.aws_caller_identity.current.account_id
  region  = data.aws_region.current.name

  # The names of resources this role will deploy, most of which do not exist yet. They are
  # written here rather than waited for because they are *chosen*, not generated -- so the policy
  # can be least-privilege from the start instead of holding a wildcard until later.
  #
  # Whichever change creates each resource must take its name from this block. That is what stops
  # the policy and the resource drifting into an AccessDenied nobody can explain.
  cluster_name        = local.name
  service_name        = "${local.name}-backend"
  migrate_family      = "${local.name}-migrate"
  site_bucket         = "${local.name}-site"
  task_execution_role = "${local.name}-task-execution"
  task_role           = "${local.name}-task"

  cluster_arn     = "arn:aws:ecs:${local.region}:${local.account}:cluster/${local.cluster_name}"
  service_arn     = "arn:aws:ecs:${local.region}:${local.account}:service/${local.cluster_name}/${local.service_name}"
  site_bucket_arn = "arn:aws:s3:::${local.site_bucket}"
}

# Only this repository, and only a job running in the GitHub environment of the same name.
#
# The environment condition is the load-bearing half. GitHub will not issue a token claiming
# `environment:prod` unless the job declares that environment, and a protected environment
# requires an approval before the job starts -- so the prod approval gate is enforced by AWS
# refusing the credentials, not only by GitHub choosing to wait.
data "aws_iam_policy_document" "deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:environment:${var.environment}"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name               = "${local.name}-deploy"
  description        = "Redeploys the ${var.environment} application from GitHub Actions. Cannot change infrastructure."
  assume_role_policy = data.aws_iam_policy_document.deploy_trust.json

  tags = { Name = "${local.name}-deploy" }
}

data "aws_iam_policy_document" "deploy" {
  # Point the running service at a new task definition. This is what a backend deploy *is*, and
  # it is scoped to one service ARN, so this role cannot touch the other environment's service.
  statement {
    sid = "UpdateTheBackendService"
    actions = [
      "ecs:UpdateService",
      "ecs:DescribeServices",
    ]
    resources = [local.service_arn]
  }

  # Registering a task definition cannot be restricted to a resource: the call *creates* one, so
  # there is no ARN or tag for a condition to match. Stated plainly because the alternative is
  # believing this role is fenced in when it is not -- the qa role can register a revision in
  # prod's family.
  #
  # It is tolerable because a task definition nobody runs is inert, and the calls that would run
  # or deploy one -- UpdateService above, RunTask below -- are both scoped. If that ever stops
  # being true, this is the statement to revisit.
  statement {
    sid = "RegisterTaskDefinitionsWhichCannotBeScoped"
    actions = [
      "ecs:RegisterTaskDefinition",
      "ecs:DescribeTaskDefinition",
    ]
    resources = ["*"]
  }

  # The one-off Liquibase task, and watching it finish. Restricted to the migration family, and
  # to this environment's cluster.
  statement {
    sid       = "RunTheMigrationTask"
    actions   = ["ecs:RunTask"]
    resources = ["arn:aws:ecs:${local.region}:${local.account}:task-definition/${local.migrate_family}:*"]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [local.cluster_arn]
    }
  }

  statement {
    sid = "WatchTasksInThisCluster"
    actions = [
      "ecs:DescribeTasks",
      "ecs:ListTasks",
      "ecs:StopTask",
    ]
    resources = ["arn:aws:ecs:${local.region}:${local.account}:task/${local.cluster_name}/*"]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [local.cluster_arn]
    }
  }

  # The statement that decides whether any of the above is actually safe.
  #
  # Running a task means handing it a role. Granted on "*", this one permission would let the
  # deployer attach *any* role in the account to a task and read that role's credentials out of
  # it -- turning "redeploy the application" into account administrator in a single step. So it
  # names exactly the two roles this environment's tasks use, and the condition means they can
  # only ever be passed to ECS.
  statement {
    sid     = "PassOnlyThisEnvironmentsTaskRolesAndOnlyToEcs"
    actions = ["iam:PassRole"]
    resources = [
      "arn:aws:iam::${local.account}:role/${local.task_execution_role}",
      "arn:aws:iam::${local.account}:role/${local.task_role}",
    ]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  # The frontend deploy: sync a release artifact into this environment's site bucket.
  statement {
    sid       = "ListTheSiteBucket"
    actions   = ["s3:ListBucket"]
    resources = [local.site_bucket_arn]
  }

  statement {
    sid = "WriteTheSiteBucket"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["${local.site_bucket_arn}/*"]
  }

  # Deliberately absent: cloudfront:CreateInvalidation. A distribution's id is generated by AWS
  # rather than chosen, so unlike everything above its ARN cannot be written before it exists.
  # It joins this policy in the change that creates the distribution, scoped to that ARN, rather
  # than being granted on "*" now.
  #
  # Also deliberately absent: any Deny keyed on the env tag. With every statement above scoped to
  # an ARN built from this environment's name, there is no grant for such a Deny to catch -- and
  # the one statement that cannot be scoped, RegisterTaskDefinition, has no resource to carry a
  # tag either, so a tag Deny would not catch that one and would only look reassuring.
}

resource "aws_iam_role_policy" "deploy" {
  name   = "${local.name}-deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
