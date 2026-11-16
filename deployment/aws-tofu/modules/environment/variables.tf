variable "project" {
  description = "Name prefix for every resource, so one account can hold more than this."
  type        = string
  default     = "taskfest"
}

variable "environment" {
  description = "Which environment this is. Everything is tagged with it, and the budgets filter on that tag."
  type        = string

  validation {
    condition     = contains(["qa", "prod"], var.environment)
    error_message = "environment must be qa or prod: the tag drives cost attribution and the IAM policies."
  }
}

variable "github_oidc_repository" {
  description = <<-EOT
    The repository whose workflows may assume this environment's deploy role, exactly as GitHub
    writes it into the OIDC token's `sub` claim after `repo:`. Part of the trust condition, so a
    token from any other repository is refused.

    The repository uses GitHub's *immutable subject*, so this is owner@id/name@id rather than
    owner/name: a repository deleted and recreated under the same name, or a rename, gets new
    ids and is refused, where the plain name could not tell them apart. The value is what
    `gh api repos/<owner>/<repo>/actions/oidc/customization/sub` reports as sub_claim_prefix,
    without the leading `repo:`. A plain owner/name here was why the first deploy could not
    assume the role.

    It has a default because it is a property of the project rather than of an environment --
    keeping it out of the values files, which exist for what actually differs between qa and
    prod.
  EOT
  type        = string
  default     = "guhilling@2537533/ai-assisted-todolist@1383592232"
}

variable "log_retention_days" {
  description = "How long the Go backend's logs are kept. Shorter in qa than in prod, per doc/deployment/observability.md."
  type        = number
}

variable "hostname" {
  description = "The environment's public name, which CloudFront answers on."
  type        = string
}

variable "dns_zone" {
  description = "The existing Route 53 zone the hostname lives in. A property of the project, not of an environment."
  type        = string
  default     = "cloud.hilling.de"
}

variable "google_ios_client_id" {
  description = <<-EOT
    The Google OAuth client of this environment's iOS app (#280). Google's iOS SDK issues ID tokens
    for it rather than for the web client, so the backend accepts it as an audience too. Not a
    secret: it is in the app. Empty leaves the backend accepting no iOS app's tokens.
  EOT
  type        = string
  default     = ""
}

variable "apple_sign_in" {
  description = <<-EOT
    Sign in with Apple on the website (#281), a provider beside Google. The Services ID, the key's
    id and the team id are from the Apple developer account and not secrets; the key itself is in
    Secrets Manager (sign-in.tf), put in by hand. A Services ID creates the secret; `offered` turns
    the provider on, and only once the key is in: the function reads it at a cold start, and an
    empty secret would stop every start, Google's sign-in and the whole API with it.
  EOT
  type = object({
    services_id = string
    key_id      = string
    team_id     = string
    offered     = bool
  })
  default = { services_id = "", key_id = "", team_id = "", offered = false }

  validation {
    condition     = !var.apple_sign_in.offered || (var.apple_sign_in.services_id != "" && var.apple_sign_in.key_id != "" && var.apple_sign_in.team_id != "")
    error_message = "Offering Sign in with Apple needs its Services ID, key id and team id."
  }
}

variable "google_client_id" {
  description = <<-EOT
    The Google OAuth client this environment signs in with, from the Google console. Not a
    secret -- it is part of every sign-in redirect -- so it is in terraform.tfvars; the client
    secret is in Secrets Manager (sign-in.tf). Empty means sign-in stays off in this environment.
  EOT
  type        = string
  default     = ""
}

variable "test_sign_in" {
  description = <<-EOT
    Whether this environment has the test accounts its live tests sign in with: a Cognito user pool
    beside Google, offered as a second sign-in provider (test-sign-in.tf, #190). qa only -- prod
    signs in with Google alone.
  EOT
  type        = bool
  default     = false

  # Not a convention but a check, because qa is written into what it creates: the mobile app's
  # client returns to the qa build's URL scheme (test-sign-in.tf), and prod's build has another.
  validation {
    condition     = !var.test_sign_in || var.environment == "qa"
    error_message = "test_sign_in is for qa only: the mobile app's test client returns to the qa build's URL scheme."
  }
}

variable "table_name" {
  description = <<-EOT
    The Go backend's table, when it is not the one this module names itself: set to a restored
    table's name when the functions are switched to it (doc/deployment/serverless.md).
  EOT
  type        = string
  default     = ""
}

variable "table_point_in_time_recovery" {
  description = "Whether the Go backend's table keeps point-in-time recovery (#553): prod only."
  type        = bool
  default     = false
}

variable "monitoring_endpoint" {
  description = <<-EOT
    The shared monitoring server's HTTPS address (#508, guhilling/monitoring), to which logship
    sends the functions' and the HTTP API's logs, or empty to send nothing. Where it is set, the
    sender's password must be in the SSM SecureString /<project>/<environment>/monitoring-password
    before the apply (doc/deployment/observability.md).
  EOT
  type        = string
  default     = ""

  validation {
    condition     = var.monitoring_endpoint == "" || startswith(var.monitoring_endpoint, "https://")
    error_message = "monitoring_endpoint is empty or an https:// address."
  }
}
