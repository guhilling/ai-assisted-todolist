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
  vpc_cidr             = var.vpc_cidr
  public_subnet_cidrs  = var.public_subnet_cidrs
  private_subnet_cidrs = var.private_subnet_cidrs
  running              = var.running
  db_restore_snapshot  = var.db_restore_snapshot
  backend_image        = var.backend_image
  log_retention_days   = var.log_retention_days
  hostname             = var.hostname
  google_client_id     = var.google_client_id
  test_sign_in         = var.test_sign_in

  blue_green_bake_minutes      = var.blue_green_bake_minutes
  deregistration_delay_seconds = var.deregistration_delay_seconds
}

output "vpc_id" {
  description = "The environment's VPC."
  value       = module.environment.vpc_id
}

output "name_prefix" {
  description = "The prefix every resource in this environment is named with."
  value       = module.environment.name_prefix
}

output "deploy_role_arn" {
  description = "The role GitHub Actions assumes to deploy this environment."
  value       = module.environment.deploy_role_arn
}

output "lifecycle_role_arn" {
  description = "The role a person assumes, with MFA, to create or destroy what bills in this environment."
  value       = module.environment.lifecycle_role_arn
}

output "running" {
  description = "Whether this environment's billable resources exist, as of the last apply."
  value       = module.environment.running
}

output "db_endpoint" {
  description = "Where the database listens, host:port, or null while the environment is down."
  value       = module.environment.db_endpoint
}

output "db_app_user" {
  description = "The database user the backend logs in as, with IAM authentication."
  value       = module.environment.db_app_user
}

output "db_master_secret_arn" {
  description = "The RDS-managed master credentials, for bootstrapping and administration only."
  value       = module.environment.db_master_secret_arn
}

output "task_role_arn" {
  description = "What the backend container runs as."
  value       = module.environment.task_role_arn
}

output "cluster_name" {
  description = "The ECS cluster the one-off tasks run in."
  value       = module.environment.cluster_name
}

output "public_subnet_ids" {
  description = "Where the tasks run, with a public IP for their outbound calls."
  value       = module.environment.public_subnet_ids
}

output "tasks_security_group_id" {
  description = "The security group the tasks run in: the only one the database admits."
  value       = module.environment.tasks_security_group_id
}

output "db_bootstrap_task_family" {
  description = "The task that creates the application's database user."
  value       = module.environment.db_bootstrap_task_family
}

output "migrate_task_family" {
  description = "The task that runs Liquibase over IAM authentication."
  value       = module.environment.migrate_task_family
}

output "url" {
  description = "Where this environment answers, through CloudFront."
  value       = module.environment.url
}

output "test_accounts_user_pool_id" {
  description = "The Cognito pool of the test accounts the live tests sign in with, or null where there is none."
  value       = module.environment.test_accounts_user_pool_id
}
