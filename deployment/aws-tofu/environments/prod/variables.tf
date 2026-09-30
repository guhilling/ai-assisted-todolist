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
