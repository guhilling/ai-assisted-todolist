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
  # Reading is broad, and has to be. `tofu apply` refreshes the *whole* root, not the subset it
  # is about to change, so this role must be able to read every resource in the module -- the
  # VPC, the subnets, the security groups, the other two IAM roles -- even though it can write
  # none of them. That is the price of the single-root design, and it is the right trade: reads
  # cannot change anything, and the alternative was a second root and a state migration.
  #
  # **The wildcards are per service and deliberately wide.** Three applies failed in a row on a
  # missing read action -- ec2:DescribeManagedPrefixLists was granted but the data source also
  # calls ec2:GetManagedPrefixListEntries, and `ec2:Describe*` does not match `Get*`. Naming
  # read actions one at a time turns every new resource into a 403 and a round trip, so the
  # services this project uses get Describe/Get/List wholesale. The security boundary of this
  # role is its *writes*, which stay narrow; a read cannot change anything.
  #
  # The services listed go beyond what the module contains today, on purpose: CloudFront, Route
  # 53, ACM and the rest are already in the plan, and adding them now costs nothing.
  #
  # S3 is the deliberate exception and is NOT wildcarded here -- see the two statements below.
  # `s3:Get*` would let the qa role read prod's state file, which holds every attribute of every
  # prod resource. That is the one read worth refusing.
  statement {
    sid = "ReadEverythingInTheRootSoApplyCanRefresh"
    actions = [
      "acm:Describe*",
      "acm:Get*",
      "acm:List*",
      "application-autoscaling:Describe*",
      "cloudfront:Get*",
      "cloudfront:List*",
      "cloudwatch:Describe*",
      "cloudwatch:Get*",
      "cloudwatch:List*",
      "ec2:Describe*",
      "ec2:Get*",
      "ecs:Describe*",
      "ecs:List*",
      "elasticloadbalancing:Describe*",
      "iam:Get*",
      "iam:List*",
      "kms:Describe*",
      "kms:List*",
      "logs:Describe*",
      "logs:Get*",
      "logs:List*",
      "rds:Describe*",
      "rds:List*",
      "route53:Get*",
      "route53:List*",
      # Describe and List only: GetSecretValue is a real privilege, and refreshing a secret does
      # not need it. If a resource ever does, it gets its own statement and its own reason.
      "secretsmanager:Describe*",
      "secretsmanager:List*",
      "servicediscovery:Get*",
      "servicediscovery:List*",
    ]
    resources = ["*"]
  }

  # Bucket-level reads for this environment's own buckets, so a refresh can see their
  # configuration. Bucket-level only: no object actions, which is what keeps the statement below
  # the only way this role reaches an object.
  statement {
    sid = "ReadThisEnvironmentsOwnBucketConfiguration"
    actions = [
      "s3:GetBucket*",
      "s3:GetAccelerateConfiguration",
      "s3:GetEncryptionConfiguration",
      "s3:GetLifecycleConfiguration",
      "s3:GetReplicationConfiguration",
      "s3:ListBucket",
    ]
    resources = [
      "arn:aws:s3:::${local.site_bucket}",
      "arn:aws:s3:::${local.flow_log_bucket}",
      "arn:aws:s3:::${var.state_bucket}",
    ]
  }

  # The state backend. Without this the role cannot run OpenTofu at all: the first thing an apply
  # does is read the state object, which failed with a bare S3 403 naming no bucket.
  #
  # ListBucket on the state bucket carries no prefix condition, deliberately: the backend lists
  # to decide whether the state exists, and a wrong prefix condition fails as a 403 that looks
  # like a missing bucket. It is granted by the bucket-configuration statement above. Seeing the
  # other environment's key name discloses nothing; reading it would, which is the next
  # statement's job to prevent.
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
  #
  # Unlike the service and the load balancer, this is NOT pinned to the VPC, because RDS offers
  # no condition key for it: CreateDBSubnetGroup cannot be conditioned on its subnets, nor
  # CreateDBInstance on its security groups. This role could therefore build its own database in
  # the other environment's subnets. Accepted because the role is assumed by a person with MFA
  # and is an audit boundary, not a security one -- see the header of this file.
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

  # Creating the load balancer is where it is placed, so the name in the ARN is not enough: this
  # pins it to this environment's private subnets and its own security group, and to internal,
  # so an apply can neither put it in the other environment's VPC nor give it a public address.
  #
  # ForAllValues passes on an absent key, which is safe here only because an ALB cannot be
  # created without subnets. The scheme is a plain StringEquals, so it must be stated.
  statement {
    sid       = "CreateTheLoadBalancerInsideThisEnvironment"
    actions   = ["elasticloadbalancing:CreateLoadBalancer"]
    resources = ["arn:aws:elasticloadbalancing:${local.region}:${local.account}:loadbalancer/app/${local.alb_name}/*"]

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "elasticloadbalancing:Subnet"
      values   = aws_subnet.private[*].id
    }

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "elasticloadbalancing:SecurityGroup"
      values   = [aws_security_group.alb.id]
    }

    condition {
      test     = "StringEquals"
      variable = "elasticloadbalancing:Scheme"
      values   = ["internal"]
    }
  }

  # The rest of the load balancer and its target groups. Blue/green needs two target groups,
  # which is why the names are a prefix match rather than one ARN.
  statement {
    sid = "TheLoadBalancer"
    actions = [
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
  # Pinned to this environment's subnets for the same reason as in deploy.tf: the subnets decide
  # the VPC, and with it whose database the tasks can reach.
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

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "ecs:subnet"
      values   = aws_subnet.public[*].id
    }
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
