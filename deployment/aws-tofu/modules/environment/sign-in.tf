# Google sign-in: the OAuth client's secret, and nothing else.
#
# The client itself is created by hand in the Google console -- it cannot be automated -- and its
# id is in terraform.tfvars (`google_client_id`), because it is not a secret: it travels in every
# sign-in redirect. The client secret is. OpenTofu creates the secret *without* a value, and the
# value is put in by a person with `aws secretsmanager put-secret-value`, so it never passes
# through this repository or OpenTofu state. doc/deployment/names-and-certificates.md has the command.
#
# It does not rotate by itself. The Go backend reads it at a cold start (serverless.tf), so
# changing it means putting a new value and letting the functions start again, or deploying.
#
# About $0.40 a month.

locals {
  google_client_secret = "${local.name}-google-client-secret"

  # Sign-in is on only where a Google client exists. An environment without one starts with
  # sign-in off rather than failing on a secret with no value.
  sign_in_enabled = var.google_client_id != ""
}

# AWS-0098, a customer-managed KMS key: about $1 a month for one secret, more than the secret.
# Secrets Manager encrypts it with its own AWS-managed key regardless.
#trivy:ignore:AWS-0098
resource "aws_secretsmanager_secret" "google_client_secret" {
  name        = local.google_client_secret
  description = "The ${var.environment} Google OAuth client secret. Value set by hand, never by OpenTofu."

  # The default 30-day recovery window would block re-creating the same name for a month after
  # the environment is destroyed; a week is enough to notice a mistake.
  recovery_window_in_days = 7

  tags = { Name = local.google_client_secret }
}
