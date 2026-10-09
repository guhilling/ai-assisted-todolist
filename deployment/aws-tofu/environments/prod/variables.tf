# Identical to the other environment's. The values are in terraform.tfvars.

variable "region" {
  description = "Where the environment runs. Note that CloudFront's certificate must be in us-east-1 whatever this is."
  type        = string
}

variable "project" {
  description = "Name prefix for every resource."
  type        = string
}

variable "environment" {
  description = "qa or prod."
  type        = string
}

variable "vpc_cidr" {
  description = "Address space for this environment. The two environments do not overlap."
  type        = string
}

variable "public_subnet_cidrs" {
  description = "Two subnets for the ECS tasks."
  type        = list(string)
}

variable "private_subnet_cidrs" {
  description = "Two subnets for the internal load balancer."
  type        = list(string)
}

variable "running" {
  description = "Whether the billable resources exist. Passed on the command line, never in terraform.tfvars -- see env.sh."
  type        = bool
  default     = false
}

variable "db_restore_snapshot" {
  description = "Snapshot a newly created database is restored from. Passed by env.sh up, never in terraform.tfvars."
  type        = string
  default     = null
}

variable "backend_image" {
  description = "The release the backend runs, by version and digest. Passed by env.sh up, never in terraform.tfvars."
  type        = string
  default     = null
}

variable "test_sign_in" {
  description = "Whether this environment has the Cognito test accounts its live tests sign in with."
  type        = bool
  default     = false
}

variable "log_retention_days" {
  description = "How long the ECS task logs are kept."
  type        = number
}

variable "hostname" {
  description = "The environment's public name, under the cloud.hilling.de zone."
  type        = string
}

variable "google_client_id" {
  description = "The Google OAuth client id; empty keeps sign-in off. The secret is not here -- see sign-in.tf."
  type        = string
}

variable "blue_green_bake_minutes" {
  description = "How long both versions run after a blue/green switch, for an instant rollback."
  type        = number
}

variable "deregistration_delay_seconds" {
  description = "How long a target leaving the load balancer keeps its connections; every rollout waits on it."
  type        = number
}

variable "cpu_architecture" {
  description = "What the Fargate tasks run on: X86_64, or ARM64 for Graviton (#250)."
  type        = string
  default     = "X86_64"
}
