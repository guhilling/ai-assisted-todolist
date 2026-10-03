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
  # Every service the module uses gets all of its read verbs (Describe, Get, List -- whichever it
  # has), checked against AWS's service reference: CloudFront's Describe* was missing until the
  # CloudFront Function made `up` call DescribeFunction, and ECS and load balancing had no Get*.
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
      "cloudfront:Describe*",
      "cloudfront:Get*",
      "cloudfront:List*",
      "cloudwatch:Describe*",
      "cloudwatch:Get*",
      "cloudwatch:List*",
      "ec2:Describe*",
      "ec2:Get*",
      "ecs:Describe*",
      "ecs:Get*",
      "ecs:List*",
      "elasticloadbalancing:Describe*",
      "elasticloadbalancing:Get*",
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
      # Describe and List, and the one Get a refresh needs: reading a secret's resource policy.
      # Not Get*, because that would include GetSecretValue -- a real privilege, which refreshing
      # a secret does not need.
      "secretsmanager:Describe*",
      "secretsmanager:GetResourcePolicy",
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
  # no condition key for it: CreateDBInstance cannot be conditioned on its security groups. This
  # role could therefore attach the other environment's database security group to its own
  # instance. Accepted because the role is assumed by a person with MFA
  # and is an audit boundary, not a security one -- see the header of this file.
  #
  # Creating and restoring are where an instance gets its network placement, so they carry the
  # one placement condition RDS offers: never publicly accessible. The default parameter and
  # option groups are listed because both calls are authorised against them too, even when, as
  # here, they are only used implicitly.
  statement {
    sid = "CreateTheDatabaseNeverPublic"
    actions = [
      "rds:CreateDBInstance",
      "rds:RestoreDBInstanceFromDBSnapshot",
    ]
    resources = [
      "arn:aws:rds:${local.region}:${local.account}:db:${local.db_instance}",
      "arn:aws:rds:${local.region}:${local.account}:snapshot:${local.name}-*",
      "arn:aws:rds:${local.region}:${local.account}:subgrp:${local.db_subnet_group}",
      "arn:aws:rds:${local.region}:${local.account}:pg:default.${local.db_engine}${local.db_engine_major}",
      "arn:aws:rds:${local.region}:${local.account}:og:default:${local.db_engine}-${local.db_engine_major}",
    ]

    condition {
      test     = "Bool"
      variable = "rds:PubliclyAccessible"
      values   = ["false"]
    }
  }

  statement {
    sid = "TheDatabase"
    actions = [
      "rds:DeleteDBInstance",
      "rds:ModifyDBInstance",
      "rds:RebootDBInstance",
      "rds:AddTagsToResource",
      "rds:RemoveTagsFromResource",
      "rds:CreateDBSnapshot",
    ]
    resources = [
      "arn:aws:rds:${local.region}:${local.account}:db:${local.db_instance}",
      "arn:aws:rds:${local.region}:${local.account}:snapshot:${local.name}-*",
      "arn:aws:rds:${local.region}:${local.account}:subgrp:${local.db_subnet_group}",
      "arn:aws:rds:${local.region}:${local.account}:pg:default.${local.db_engine}${local.db_engine_major}",
      "arn:aws:rds:${local.region}:${local.account}:og:default:${local.db_engine}-${local.db_engine_major}",
    ]
  }

  # The managed master password. RDS creates the secret with the caller's own permissions, which
  # is why this role needs them at all; aws:CalledVia limits them to exactly that, so the role
  # cannot create or tag secrets of its own. The secret's name is chosen by RDS (rds!db-<uuid>),
  # so there is no environment in it to scope by. kms:DescribeKey on the Secrets Manager key,
  # which AWS also lists, is already covered by the read statement above.
  statement {
    sid = "SecretsManagerOnBehalfOfRds"
    actions = [
      "secretsmanager:CreateSecret",
      "secretsmanager:TagResource",
    ]
    resources = ["arn:aws:secretsmanager:${local.region}:${local.account}:secret:rds!db-*"]

    condition {
      test     = "ForAnyValue:StringEquals"
      variable = "aws:CalledVia"
      values   = ["rds.amazonaws.com"]
    }
  }

  # Deliberately no CreateDBSubnetGroup: the subnet group is free, so it is foundation
  # (database.tf), created by an administrator and left standing across teardowns.

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
      "elasticloadbalancing:CreateRule",
      "elasticloadbalancing:DeleteRule",
      "elasticloadbalancing:ModifyRule",
    ]
    resources = [
      "arn:aws:elasticloadbalancing:${local.region}:${local.account}:loadbalancer/app/${local.alb_name}/*",
      "arn:aws:elasticloadbalancing:${local.region}:${local.account}:targetgroup/${local.name}-*/*",
      "arn:aws:elasticloadbalancing:${local.region}:${local.account}:listener/app/${local.alb_name}/*/*",
      "arn:aws:elasticloadbalancing:${local.region}:${local.account}:listener-rule/app/${local.alb_name}/*/*/*",
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

  # The two one-off tasks, started by a person through env.sh: creating the database user and
  # running the migrations. Only those two families and only in this environment's cluster --
  # the bootstrap task carries the master credentials, which is why the deploy role cannot run it.
  statement {
    sid     = "RunTheOneOffTasks"
    actions = ["ecs:RunTask"]
    resources = [
      "arn:aws:ecs:${local.region}:${local.account}:task-definition/${local.db_bootstrap_family}:*",
      "arn:aws:ecs:${local.region}:${local.account}:task-definition/${local.migrate_family}:*",
    ]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [local.cluster_arn]
    }
  }

  statement {
    sid       = "StopATaskInThisCluster"
    actions   = ["ecs:StopTask"]
    resources = ["arn:aws:ecs:${local.region}:${local.account}:task/${local.cluster_name}/*"]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [local.cluster_arn]
    }
  }

  # Registering a tagged task definition is also a TagResource call on it, and the provider's
  # default_tags tag everything. Scoped to this environment's families -- all three, including
  # the backend's own, which the first `up` of the service found missing.
  statement {
    sid     = "TagThisEnvironmentsTaskDefinitions"
    actions = ["ecs:TagResource", "ecs:UntagResource"]
    resources = [
      "arn:aws:ecs:${local.region}:${local.account}:task-definition/${local.db_bootstrap_family}:*",
      "arn:aws:ecs:${local.region}:${local.account}:task-definition/${local.migrate_family}:*",
      "arn:aws:ecs:${local.region}:${local.account}:task-definition/${local.service_name}:*",
    ]
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
        "vpcorigin.cloudfront.amazonaws.com",
      ]
    }
  }

  # Blue/green: creating the service hands ECS the role it shifts the listener rule with. Only
  # that role, and only to ECS itself.
  statement {
    sid       = "PassTheBlueGreenRoleOnlyToEcs"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.ecs_infrastructure.arn]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs.amazonaws.com"]
    }
  }

  # CloudFront's /api/* origin comes and goes with the load balancer it points at (edge.tf), so
  # `up` and `down` must create and delete the VPC origin and change the distribution to match.
  # The distribution is named by its ARN: this role can change this environment's distribution
  # and no other, and it cannot create or delete distributions at all. VPC origin ids are
  # generated, so those are `vpcorigin/*` -- which reaches the other environment's VPC origin
  # too, accepted for the reason the database statements give: a person with MFA, an audit
  # boundary rather than a security one.
  statement {
    sid       = "UpdateThisEnvironmentsDistribution"
    actions   = ["cloudfront:UpdateDistribution"]
    resources = [aws_cloudfront_distribution.this.arn]
  }

  # CreateVpcOrigin has no resource type at all -- IAM matches it only against "*" -- so it
  # cannot share the vpcorigin/* statement below without silently never matching.
  statement {
    sid       = "CreateTheApiVpcOriginWhichCannotBeScoped"
    actions   = ["cloudfront:CreateVpcOrigin"]
    resources = ["*"]
  }

  statement {
    sid = "TheApiVpcOrigin"
    actions = [
      "cloudfront:UpdateVpcOrigin",
      "cloudfront:DeleteVpcOrigin",
      "cloudfront:TagResource",
      "cloudfront:UntagResource",
    ]
    resources = ["arn:aws:cloudfront::${local.account}:vpcorigin/*"]
  }

  # Deliberately absent: everything else in the foundation. No ec2:Create*, no ec2:Delete*, no
  # iam:CreateRole, no s3:*, no route53:*, and nothing that creates or deletes a distribution.
  # This role can make the environment cost money and stop it costing money, and it can do
  # nothing else.
}

resource "aws_iam_role_policy" "lifecycle" {
  name   = "${local.name}-lifecycle"
  role   = aws_iam_role.lifecycle.id
  policy = data.aws_iam_policy_document.lifecycle.json
}
