# One environment.
#
# This file is deliberately identical to the other environment's. Everything that differs
# between qa and prod lives in terraform.tfvars, and check-environments-match.py fails the build
# if that stops being true -- "prod is merely a parameter change" is meant to be a fact rather
# than an intention.

terraform {
  # OpenTofu, not Terraform -- see ../../README.md. The floor is 1.10 because backend.tf
  # interpolates a variable (1.8) and the S3 backend locks without DynamoDB (1.10).
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

  # Every resource carries these. With one AWS account there is no per-account bill, so the
  # env tag is what the budgets filter on -- an untagged resource is invisible to them.
  default_tags {
    tags = {
      project    = var.project
      env        = var.environment
      managed-by = "opentofu"
    }
  }
}

# The same account and tags, in us-east-1: CloudFront accepts viewer certificates from that
# region only. Used for nothing else.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      project    = var.project
      env        = var.environment
      managed-by = "opentofu"
    }
  }
}

module "environment" {
  source = "../../modules/environment"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  project              = var.project
  environment          = var.environment
  log_retention_days   = var.log_retention_days
  hostname             = var.hostname
  google_client_id     = var.google_client_id
  google_ios_client_id = var.google_ios_client_id
  apple_sign_in        = var.apple_sign_in
  test_sign_in         = var.test_sign_in

  table_point_in_time_recovery = var.table_point_in_time_recovery
  table_name                   = var.table_name
  monitoring_endpoint          = var.monitoring_endpoint
}

output "name_prefix" {
  description = "The prefix every resource in this environment is named with."
  value       = module.environment.name_prefix
}

output "deploy_role_arn" {
  description = "The role GitHub Actions assumes to deploy this environment."
  value       = module.environment.deploy_role_arn
}

output "url" {
  description = "Where this environment answers, through CloudFront."
  value       = module.environment.url
}

output "test_accounts_user_pool_id" {
  description = "The Cognito pool of the test accounts the live tests sign in with, or null where there is none."
  value       = module.environment.test_accounts_user_pool_id
}

output "test_accounts_issuer" {
  description = "The test accounts' issuer, for the mobile app's qa build (TASKFEST_QA_COGNITO_ISSUER)."
  value       = module.environment.test_accounts_issuer
}

output "test_accounts_app_client_id" {
  description = "The mobile app's client among the test accounts, for its qa build (TASKFEST_QA_APP_CLIENT_ID)."
  value       = module.environment.test_accounts_app_client_id
}
