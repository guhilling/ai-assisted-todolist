# Sign-in's secrets: Google's OAuth client secret, and Apple's signing key (#281).
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

  # Apple's key exists from the Services ID on; the provider is offered only once Gunnar says the
  # key is in (variables.tf), and only beside Google.
  apple_signing_key = "${local.name}-apple-signing-key"
  apple_key_exists  = var.apple_sign_in.services_id != ""
  apple_offered     = local.sign_in_enabled && local.apple_key_exists && var.apple_sign_in.offered
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

# Sign in with Apple's private key (#281), the .p8 file's text: the backend signs Apple's client
# secret with it for every sign-in (doc/authentication.md). Created empty, the value put in by hand
# like Google's (doc/deployment/names-and-certificates.md). About $0.40 a month.
#trivy:ignore:AWS-0098
resource "aws_secretsmanager_secret" "apple_signing_key" {
  count = local.apple_key_exists ? 1 : 0

  name                    = local.apple_signing_key
  description             = "The ${var.environment} Sign in with Apple key (.p8). Value set by hand, never by OpenTofu."
  recovery_window_in_days = 7

  tags = { Name = local.apple_signing_key }
}
