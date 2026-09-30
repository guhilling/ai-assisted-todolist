variable "project" {
  description = "Name prefix for every resource, so one account can hold more than this."
  type        = string
  default     = "todolist"
}

variable "environment" {
  description = "Which environment this is. Everything is tagged with it, and the budgets filter on that tag."
  type        = string

  validation {
    condition     = contains(["qa", "prod"], var.environment)
    error_message = "environment must be qa or prod: the tag drives cost attribution and the IAM policies."
  }
}

variable "vpc_cidr" {
  description = "Address space for the environment's VPC. The two environments must not overlap if they are ever peered."
  type        = string
}

variable "public_subnet_cidrs" {
  description = <<-EOT
    Subnets for the ECS tasks, which take a public IP so they can reach the image registry and
    the identity provider without a NAT gateway. Two, because the load balancer requires two
    availability zones -- that is the reason, not availability.
  EOT
  type        = list(string)

  validation {
    condition     = length(var.public_subnet_cidrs) == 2
    error_message = "exactly two public subnets: the load balancer requires two availability zones."
  }
}

variable "private_subnet_cidrs" {
  description = <<-EOT
    Subnets for the internal load balancer. Nothing in them makes outbound calls, so they need
    no NAT gateway -- which is what keeps the largest avoidable line item off the bill.
  EOT
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_cidrs) == 2
    error_message = "exactly two private subnets: the load balancer requires two availability zones."
  }
}

variable "backend_port" {
  description = "The port the Quarkus container listens on."
  type        = number
  default     = 8080
}

variable "github_repository" {
  description = <<-EOT
    The repository whose workflows may assume this environment's deploy role, as owner/name.
    Part of the OIDC trust condition, so a token from any other repository is refused. It has a
    default because it is a property of the project rather than of an environment -- keeping it
    out of the values files, which exist for what actually differs between qa and prod.
  EOT
  type        = string
  default     = "guhilling/ai-assisted-todolist"
}
