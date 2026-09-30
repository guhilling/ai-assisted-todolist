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
  # Reading is unrestricted, and has to be: Describe and List calls take no resource, so there is
  # nothing to scope them to. This is also what lets a plan refresh the foundation it does not
  # own -- it can see the VPC and the security groups, and cannot touch them.
  statement {
    sid = "ReadEnoughToPlan"
    actions = [
      "ec2:Describe*",
      "rds:Describe*",
      "rds:ListTagsForResource",
      "elasticloadbalancing:Describe*",
      "ecs:Describe*",
      "ecs:List*",
      "logs:Describe*",
      "iam:GetRole",
      "iam:ListRolePolicies",
      "iam:GetRolePolicy",
      "iam:ListAttachedRolePolicies",
      "secretsmanager:DescribeSecret",
      "secretsmanager:ListSecrets",
      "kms:DescribeKey",
      "kms:ListAliases",
    ]
    resources = ["*"]
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
