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
      version = "~> 5.0"
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

module "environment" {
  source = "../../modules/environment"

  project              = var.project
  environment          = var.environment
  vpc_cidr             = var.vpc_cidr
  public_subnet_cidrs  = var.public_subnet_cidrs
  private_subnet_cidrs = var.private_subnet_cidrs
  running              = var.running
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
