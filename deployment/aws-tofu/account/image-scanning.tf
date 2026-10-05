# Container image scanning (#162): the backend image reaches ECS through ECR, where Amazon
# Inspector scans it, and a daily workflow turns what Inspector finds into a GitHub issue.
#
# The images are still built and published to Quay. ECR's pull-through cache fetches one from
# there the first time a task asks for it, under `quay/…`, and serves it from then on. That is the
# whole reason ECR is here: Inspector scans images in ECR, not in Quay, and only in ECR can it see
# which of them ECS actually runs. doc/decisions/deployment-and-aws.md has the reasoning and the
# alternatives, doc/deployment/image-scanning.md how it works day to day.
#
# All of it is account-wide, like everything in this root: one cache, one registry scanning
# configuration and one Inspector per account, whatever the environment.

data "aws_caller_identity" "current" {}

# Quay's repositories are public, so the rule needs no credentials. The environments' task
# execution roles may pull through it (modules/environment/ecs.tf).
resource "aws_ecr_pull_through_cache_rule" "quay" {
  ecr_repository_prefix = "quay"
  upstream_registry_url = "quay.io"
}

# What the cache's own repositories look like when it creates them on a first pull. The lifecycle
# rule is about cost as much as storage: Inspector rescans every image a repository holds whenever
# a new CVE is published, at $0.01 a rescan, so keeping only the newest few stops paying for
# images nobody runs any more. Mutable, because `latest` moves.
resource "aws_ecr_repository_creation_template" "quay" {
  prefix               = "quay"
  description          = "Repositories ECR creates when pulling through the quay.io cache"
  applied_for          = ["PULL_THROUGH_CACHE"]
  image_tag_mutability = "MUTABLE"

  lifecycle_policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the newest five images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 5
      }
      action = { type = "expire" }
    }]
  })
}

# Inspector for ECR only. EC2, Lambda and code scanning are left off: there is nothing of those to
# scan, and each would bill on its own.
resource "aws_inspector2_enabler" "ecr" {
  account_ids    = [data.aws_caller_identity.current.account_id]
  resource_types = ["ECR"]
}

# Enhanced, continuous scanning for the cached images. Enabling Inspector switches the registry
# to enhanced scanning on its own; saying so here keeps it to `quay/*` and makes the setting
# visible rather than a side effect.
resource "aws_ecr_registry_scanning_configuration" "this" {
  scan_type = "ENHANCED"

  rule {
    scan_frequency = "CONTINUOUS_SCAN"

    repository_filter {
      filter      = "quay/*"
      filter_type = "WILDCARD"
    }
  }

  depends_on = [aws_inspector2_enabler.ecr]
}

# The identity of the daily findings workflow (.github/workflows/image-findings.yml): it may list
# Inspector's findings and nothing else. Trusted for this repository's main branch only -- a
# scheduled workflow runs there -- so a pull request cannot assume it.
data "aws_iam_policy_document" "image_findings_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_oidc_repository}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "image_findings" {
  name               = "${var.project}-image-findings"
  description        = "Lets the daily workflow on main read Amazon Inspector findings. Nothing else."
  assume_role_policy = data.aws_iam_policy_document.image_findings_trust.json
}

# ListFindings cannot be scoped to a resource; read-only, it needs no narrowing.
data "aws_iam_policy_document" "image_findings" {
  statement {
    sid       = "ReadInspectorFindings"
    actions   = ["inspector2:ListFindings"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "image_findings" {
  name   = "${var.project}-image-findings"
  role   = aws_iam_role.image_findings.id
  policy = data.aws_iam_policy_document.image_findings.json
}
