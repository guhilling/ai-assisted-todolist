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
      version = "~> 5.0"
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

resource "aws_iam_user_policy_attachment" "monitoring_read_only" {
  user       = aws_iam_user.monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}
