# Test accounts: a Cognito user pool, the second sign-in provider qa needs for its live tests (#190).
#
# Google forbids automating its sign-in, so an end-to-end test cannot sign in with a Google
# account. This pool holds accounts made for exactly that, nothing else: nobody can sign up, and
# every account is created here. The backend offers it as a second provider beside Google -- a
# named OIDC tenant, `cognito`, switched on by the task definition (billable.tf) -- and the
# Playwright suite fills in its hosted login page (#144).
#
# Only where `test_sign_in` is true: qa, never prod. It is foundation, not billable -- Cognito's
# Lite plan is free for the first 10,000 monthly active users, two accounts cost nothing -- so the
# accounts survive a down/up cycle.
#
# **No password lives anywhere.** The accounts are created without one; the live-test workflow
# sets a fresh random password at the start of every run and keeps it in memory (D2 on #141).
#
# **The app client's secret is in OpenTofu state**, unlike Google's: Cognito generates it, so the
# client resource holds it whatever is done. Accepted (D4 on #141): the state bucket is encrypted
# and only administrators and the environment's own roles read it, and the secret signs nobody in
# without an account's password. ECS gets it from an SSM SecureString, which is free where a
# Secrets Manager secret would cost $0.40 a month.

locals {
  test_sign_in = var.test_sign_in ? 1 : 0

  # The provider's id: the tenant's name in the backend, and the last segment of its two paths.
  test_provider          = "cognito"
  test_accounts_pool     = "${local.name}-test-accounts"
  test_client_secret_ssm = "/${var.project}/${var.environment}/cognito-client-secret"

  # Reserved by RFC 2606, so no Google account can ever have one of these addresses -- the email is
  # the identity, and a test account must never be someone's real account (D1 on #141). Nor can
  # example.com addresses acquire a Gravatar, which keeps the avatar a test sees predictable.
  test_accounts = {
    one = { email = "taskfest-test-one@example.com", name = "Test Account One" }
    two = { email = "taskfest-test-two@example.com", name = "Test Account Two" }
  }
}

# No MFA: a test account must be signed in by a machine, and a second factor is exactly what it
# cannot have. Nothing else can sign in here -- see admin_create_user_config.
resource "aws_cognito_user_pool" "test_accounts" {
  count = local.test_sign_in

  name           = local.test_accounts_pool
  user_pool_tier = "LITE"

  # Sign in with the email address, which is also the identity the backend keys users by.
  username_attributes = ["email"]

  admin_create_user_config {
    # No self-sign-up: the accounts below are the only ones there will ever be.
    allow_admin_create_user_only = true
  }

  mfa_configuration = "OFF"

  password_policy {
    minimum_length                   = 20
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 1
  }

  # Nobody recovers a test account: the live-test run sets a new password anyway.
  account_recovery_setting {
    recovery_mechanism {
      name     = "admin_only"
      priority = 1
    }
  }

  tags = { Name = local.test_accounts_pool }
}

# Cognito's own prefix domain for the hosted login page: no certificate, no DNS record. The
# classic hosted UI -- managed login version 1 -- is what the Lite plan offers.
resource "aws_cognito_user_pool_domain" "test_accounts" {
  count = local.test_sign_in

  domain                = local.name
  user_pool_id          = aws_cognito_user_pool.test_accounts[0].id
  managed_login_version = 1
}

resource "aws_cognito_user_pool_client" "backend" {
  count = local.test_sign_in

  name         = "${local.name}-backend"
  user_pool_id = aws_cognito_user_pool.test_accounts[0].id

  # Confidential, like the Google client: the backend is the OIDC client (backend-for-frontend).
  generate_secret = true

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  # Its own callback: since #143 every provider returns to /api/auth/callback/<id>.
  callback_urls = ["https://${var.hostname}/api/auth/callback/${local.test_provider}"]

  explicit_auth_flows = ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"]
  read_attributes     = ["email", "email_verified", "name"]

  # The backend renews the ID token with the refresh token (doc/authentication.md), so a session
  # lasts as long as Google's does: an hour per token, renewed for up to eight hours idle.
  id_token_validity      = 1
  access_token_validity  = 1
  refresh_token_validity = 1
  token_validity_units {
    id_token      = "hours"
    access_token  = "hours"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"
}

resource "aws_cognito_user" "test" {
  for_each = var.test_sign_in ? local.test_accounts : {}

  user_pool_id = aws_cognito_user_pool.test_accounts[0].id
  username     = each.value.email

  attributes = {
    email          = each.value.email
    email_verified = "true"
    name           = each.value.name
  }

  # No password and no invitation: Cognito sets a temporary password nobody knows, and the
  # live-test run replaces it with one of its own before signing in.
  message_action = "SUPPRESS"

  # The run sets a permanent password, which moves the account from FORCE_CHANGE_PASSWORD to
  # CONFIRMED. That is the account being used, not drift, and must not be planned back.
  lifecycle {
    ignore_changes = [password, temporary_password]
  }
}

# Encrypted with the AWS-managed aws/ssm key; a customer-managed one would cost $1 a month for
# nothing a test pool needs.
resource "aws_ssm_parameter" "test_client_secret" {
  count = local.test_sign_in

  name        = local.test_client_secret_ssm
  description = "The ${var.environment} Cognito app client's secret, for the backend task. Set by OpenTofu."
  type        = "SecureString"
  value       = aws_cognito_user_pool_client.backend[0].client_secret

  tags = { Name = local.test_client_secret_ssm }
}
