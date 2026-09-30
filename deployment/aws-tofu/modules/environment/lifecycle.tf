# The identity for standing this environment's billable resources up and tearing them down.
#
# This is the operation the cost model is built on: an environment nobody is demoing is meant to
# be destroyed, so creating and deleting the database, the load balancer and the running service
# is routine rather than a one-off. It gets its own role for two reasons -- a blast radius that
# stops at the things that bill, and an audit trail that says which of the two jobs a given
# session was doing.
#
# Be clear about what this role is NOT. Creating an RDS instance needs create *and* delete on
# RDS, and creating a service needs iam:PassRole; taken together that is close to administrator
# for this environment. It is a scoping and audit boundary, not a security boundary, and it will
# not survive determined misuse the way the deploy role's policy will. Which is why it is
# assumed by a person and never handed to unattended automation for prod: deleting the database
# is one API call, and the snapshot is the only way back.

locals {
  # Everything this role may act on is named from the environment prefix, so the policy scopes
  # by ARN exactly as deploy.tf does. Tags were the obvious alternative and were not used:
  # whether a given action supports an aws:RequestTag condition varies per action, and a
  # condition on an action that ignores it fails as an AccessDenied nobody can read.
  db_instance     = "${local.name}-db"
  db_subnet_group = "${local.name}-db"
  alb_name        = "${local.name}-alb"
}

# Delegated to this account's own IAM, which is the standard idiom: naming the account root as a
# principal does not grant the root *user* anything, it says that IAM policies in this account may
# grant sts:AssumeRole on this role. MFA is then required at the point of assuming it.
#
# Gunnar's user is an administrator, so this role does not contain him -- it gives him a way to
# work without administrator, and a log that says he chose to. That is the honest description.
data "aws_iam_policy_document" "lifecycle_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${local.account}:root"]
    }

    condition {
      test     = "Bool"
      variable = "aws:MultiFactorAuthPresent"
      values   = ["true"]
    }
  }
}

resource "aws_iam_role" "lifecycle" {
  name        = "${local.name}-lifecycle"
  description = "Creates and destroys the ${var.environment} resources that bill. Assumed by a person, with MFA."

  assume_role_policy = data.aws_iam_policy_document.lifecycle_trust.json

  # An hour. Long enough to apply or destroy an environment, short enough that a forgotten
  # terminal stops being credentials before the end of the day.
  max_session_duration = 3600

  tags = { Name = "${local.name}-lifecycle" }
}

data "aws_iam_policy_document" "lifecycle" {
  # Reading is broad, and has to be. `tofu apply` refreshes the *whole* root, not the subset it
  # is about to change, so this role must be able to read every resource in the module -- the
  # VPC, the subnets, the security groups, the other two IAM roles -- even though it can write
  # none of them. That is the price of the single-root design, and it is the right trade: reads
  # cannot change anything, and the alternative was a second root and a state migration.
  #
  # **The rule for anything added later: writes stay narrow, reads follow the root.** A new
  # resource type in this module needs its read action here, or the next apply fails with a 403
  # naming an API rather than a resource. The wildcards below exist so that this is usually
  # already true.
  #
  # Describe and List calls take no resource, so `*` is not a choice made here.
  statement {
    sid = "ReadEverythingInTheRootSoApplyCanRefresh"
    actions = [
      "ec2:Describe*",
      # Get*/List* rather than four named actions: the OIDC provider data source needs
      # GetOpenIDConnectProvider and ListOpenIDConnectProviders, refreshing a role wants
      # ListRoleTags, and enumerating them one at a time turns every new resource into a 403.
      # This is read-only -- it discloses IAM configuration and can change none of it.
      "iam:Get*",
      "iam:List*",
      "rds:Describe*",
      "rds:ListTagsForResource",
      "elasticloadbalancing:Describe*",
      "ecs:Describe*",
      "ecs:List*",
      "logs:Describe*",
      "secretsmanager:DescribeSecret",
      "secretsmanager:ListSecrets",
      "kms:DescribeKey",
      "kms:ListAliases",
    ]
    resources = ["*"]
  }

  # The state backend. Without this the role cannot run OpenTofu at all: the first thing an apply
  # does is read the state object, which failed with a bare S3 403 naming no bucket.
  #
  # ListBucket is on the bucket and deliberately carries no prefix condition -- the backend lists
  # to decide whether the state exists, and a wrong prefix condition fails as a 403 that looks
  # like a missing bucket. Seeing the other environment's key name discloses nothing.
  statement {
    sid = "ListTheStateBucket"
    actions = [
      "s3:ListBucket",
      "s3:GetBucketVersioning",
      "s3:GetBucketLocation",
    ]
    resources = ["arn:aws:s3:::${var.state_bucket}"]
  }

  # Only this environment's key. The qa role cannot read or write prod's state, which is the one
  # place in this policy where the separation genuinely bites: state holds every attribute of
  # every resource. The `.tflock` object the S3 backend uses for locking sits under the same
  # prefix, so it is covered.
  statement {
    sid = "ReadAndWriteOnlyThisEnvironmentsState"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["arn:aws:s3:::${var.state_bucket}/${var.environment}/*"]
  }

  # The database: the single most expensive thing in the environment, and the one whose deletion
  # is irreversible without the snapshot.
  statement {
    sid = "TheDatabase"
    actions = [
      "rds:CreateDBInstance",
      "rds:DeleteDBInstance",
      "rds:ModifyDBInstance",
      "rds:RebootDBInstance",
      "rds:AddTagsToResource",
      "rds:RemoveTagsFromResource",
      "rds:CreateDBSnapshot",
      "rds:RestoreDBInstanceFromDBSnapshot",
    ]
    resources = [
      "arn:aws:rds:${local.region}:${local.account}:db:${local.db_instance}",
      "arn:aws:rds:${local.region}:${local.account}:snapshot:${local.name}-*",
      "arn:aws:rds:${local.region}:${local.account}:subgrp:${local.db_subnet_group}",
    ]
  }

  statement {
    sid = "TheDatabaseSubnetGroup"
    actions = [
      "rds:CreateDBSubnetGroup",
      "rds:DeleteDBSubnetGroup",
      "rds:ModifyDBSubnetGroup",
    ]
    resources = ["arn:aws:rds:${local.region}:${local.account}:subgrp:${local.db_subnet_group}"]
  }

  # The load balancer and its target groups. Blue/green needs two target groups, which is why
  # the names are a prefix match rather than one ARN.
  statement {
    sid = "TheLoadBalancer"
    actions = [
      "elasticloadbalancing:CreateLoadBalancer",
      "elasticloadbalancing:DeleteLoadBalancer",
      "elasticloadbalancing:ModifyLoadBalancerAttributes",
      "elasticloadbalancing:CreateTargetGroup",
      "elasticloadbalancing:DeleteTargetGroup",
      "elasticloadbalancing:ModifyTargetGroup",
      "elasticloadbalancing:ModifyTargetGroupAttributes",
      "elasticloadbalancing:CreateListener",
      "elasticloadbalancing:DeleteListener",
      "elasticloadbalancing:ModifyListener",
      "elasticloadbalancing:AddTags",
      "elasticloadbalancing:RemoveTags",
    ]
    resources = [
      "arn:aws:elasticloadbalancing:${local.region}:${local.account}:loadbalancer/app/${local.alb_name}/*",
      "arn:aws:elasticloadbalancing:${local.region}:${local.account}:targetgroup/${local.name}-*/*",
      "arn:aws:elasticloadbalancing:${local.region}:${local.account}:listener/app/${local.alb_name}/*/*",
    ]
  }

  # The running service. Creating and deleting it is what starts and stops the Fargate bill.
  statement {
    sid = "TheService"
    actions = [
      "ecs:CreateService",
      "ecs:DeleteService",
      "ecs:UpdateService",
      "ecs:TagResource",
      "ecs:UntagResource",
    ]
    resources = [local.service_arn]
  }

  # Cannot be scoped, for the same reason as in deploy.tf: the call creates the resource, so
  # there is no ARN to match on.
  statement {
    sid = "TaskDefinitionsWhichCannotBeScoped"
    actions = [
      "ecs:RegisterTaskDefinition",
      "ecs:DeregisterTaskDefinition",
    ]
    resources = ["*"]
  }

  # Same trap, same answer as in deploy.tf: creating a service means handing it a role, and on
  # "*" this one permission would be an escalation to whatever the most privileged role in the
  # account can do.
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

  # The first load balancer or ECS service in an account needs its service-linked role to exist,
  # and the call to create one comes from whoever is applying. Conditioned so this cannot be used
  # to create a service-linked role for anything else.
  statement {
    sid       = "ServiceLinkedRolesForTheServicesAbove"
    actions   = ["iam:CreateServiceLinkedRole"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "iam:AWSServiceName"
      values = [
        "ecs.amazonaws.com",
        "elasticloadbalancing.amazonaws.com",
        "rds.amazonaws.com",
      ]
    }
  }

  # Deliberately absent: everything in the foundation. No ec2:Create*, no ec2:Delete*, no
  # iam:CreateRole, no s3:*, no cloudfront:*, no route53:*. This role can make the environment
  # cost money and stop it costing money, and it can do nothing else.
}

resource "aws_iam_role_policy" "lifecycle" {
  name   = "${local.name}-lifecycle"
  role   = aws_iam_role.lifecycle.id
  policy = data.aws_iam_policy_document.lifecycle.json
}
