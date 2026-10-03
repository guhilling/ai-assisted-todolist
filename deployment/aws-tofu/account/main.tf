# Account-wide identity: the things there is exactly one of, whatever the environment.
#
# This is a root with resources in it, which the environment roots are forbidden from having.
# The reason that rule exists is duplication -- qa and prod must not drift -- and it does not
# apply here, because there is precisely one of each of these in the account. Creating them from
# a module instantiated twice is what would actually be wrong: both environments would fight
# over the same GitHub OIDC provider.
#
# Apply this before either environment. The environments look the OIDC provider up by URL, so
# they cannot be applied until it exists.

terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      project    = var.project
      env        = "shared"
      managed-by = "opentofu"
    }
  }
}

# GitHub's OpenID Connect issuer, trusted once for the whole account.
#
# This is what replaces long-lived access keys in GitHub Actions secrets. A workflow job asks
# GitHub for a signed token describing itself -- which repository, which branch, which
# environment -- and trades it for credentials that expire in minutes. Nothing is stored in
# GitHub, so there is no key to leak or rotate, and the per-environment roles decide what any
# given job may do.
#
# There is no thumbprint_list: AWS validates this issuer's certificate chain itself for the
# well-known providers, and a pinned thumbprint would be one more thing to notice had expired.
resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"

  # The audience the workflow requests. `sts.amazonaws.com` is what the AWS credentials action
  # asks for; the roles additionally check it, so a token minted for anything else is useless.
  client_id_list = ["sts.amazonaws.com"]
}

# Read-only, everywhere, for dashboards and for looking at things without being able to change
# them. This one is a user rather than a role because it is used by a person at a console or a
# local CLI profile, not by a workflow -- there is no OIDC token to trade.
#
# No access key is created here on purpose. `aws_iam_access_key` writes the secret into state in
# cleartext, and state is a file in a bucket that more than one thing can read. Create the key in
# the console when it is wanted.
resource "aws_iam_user" "monitoring" {
  name = "${var.project}-monitoring"
}

# The permission belongs to a group rather than to the user, so that what "read-only" means is
# defined once, and a second reader is a group membership rather than a copied attachment.
# This is what Trivy's AWS-0143 asks for.
resource "aws_iam_group" "read_only" {
  name = "${var.project}-read-only"
}

resource "aws_iam_group_policy_attachment" "read_only" {
  group      = aws_iam_group.read_only.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

# Non-exclusive: it manages this user's membership of this group, and leaves any other group
# the user is added to in the console alone. aws_iam_group_membership would be the exclusive
# version and would silently remove members it does not know about.
resource "aws_iam_user_group_membership" "monitoring" {
  user   = aws_iam_user.monitoring.name
  groups = [aws_iam_group.read_only.name]
}

# MFA, enforced on the group rather than trusted to the person. ReadOnlyAccess is broad -- it
# reads every bucket's objects -- so a leaked access key on its own must be useless, which is the
# same property the lifecycle role already has.
#
# The shape is AWS's own published pattern: deny everything without MFA except what a user needs
# to set up MFA in the first place. In practice that means the console works as usual once a
# device is registered, and the CLI needs a session from `aws sts get-session-token` with the
# device's code rather than the bare access key.
data "aws_iam_policy_document" "read_only_guard" {
  # What ReadOnlyAccess does not grant and registering a device needs. Creating a virtual device
  # is on mfa/* because the device is named by whoever creates it; everything that binds a
  # device to a user is scoped to the caller's own user.
  statement {
    sid       = "CreateAVirtualMfaDevice"
    actions   = ["iam:CreateVirtualMFADevice"]
    resources = ["arn:aws:iam::*:mfa/*"]
  }

  statement {
    sid = "ManageOwnMfaDevice"
    actions = [
      "iam:EnableMFADevice",
      "iam:ResyncMFADevice",
      "iam:DeactivateMFADevice",
    ]
    resources = ["arn:aws:iam::*:user/$${aws:username}"]
  }

  statement {
    sid       = "ChangeOwnPassword"
    actions   = ["iam:ChangePassword"]
    resources = ["arn:aws:iam::*:user/$${aws:username}"]
  }

  # BoolIfExists, because a request signed with a bare access key carries no MFA key at all, and
  # a plain Bool would not match it -- the deny would then miss exactly the case it is for.
  # Deactivating a device is deliberately not in the exception list: that takes MFA.
  statement {
    sid    = "DenyEverythingElseWithoutMfa"
    effect = "Deny"
    not_actions = [
      "iam:CreateVirtualMFADevice",
      "iam:EnableMFADevice",
      "iam:ResyncMFADevice",
      "iam:GetUser",
      "iam:ListMFADevices",
      "iam:ListVirtualMFADevices",
      "iam:ChangePassword",
      "sts:GetSessionToken",
    ]
    resources = ["*"]

    condition {
      test     = "BoolIfExists"
      variable = "aws:MultiFactorAuthPresent"
      values   = ["false"]
    }
  }

  # With or without MFA. Looking at the account never needs the state, and the state is the one
  # place where every attribute of every resource -- prod's included -- sits in one readable file.
  statement {
    sid       = "NeverReadTheState"
    effect    = "Deny"
    actions   = ["s3:GetObject", "s3:GetObjectVersion"]
    resources = ["arn:aws:s3:::${var.state_bucket}/*"]
  }
}

resource "aws_iam_group_policy" "read_only_guard" {
  name   = "${var.project}-read-only-guard"
  group  = aws_iam_group.read_only.name
  policy = data.aws_iam_policy_document.read_only_guard.json
}
