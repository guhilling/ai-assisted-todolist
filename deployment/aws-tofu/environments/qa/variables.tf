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

variable "test_sign_in" {
  description = "Whether this environment has the Cognito test accounts its live tests sign in with."
  type        = bool
  default     = false
}

variable "log_retention_days" {
  description = "How long the Go backend's logs are kept."
  type        = number
}

variable "hostname" {
  description = "The environment's public name, under the cloud.hilling.de zone."
  type        = string
}

variable "google_ios_client_id" {
  description = "The Google OAuth client of this environment's iOS app (#280); empty while there is none."
  type        = string
  default     = ""
}

variable "apple_sign_in" {
  description = "Sign in with Apple (#281): the Services ID, key id and team id, and whether it is offered. Off while empty."
  type = object({
    services_id = string
    key_id      = string
    team_id     = string
    offered     = bool
  })
  default = { services_id = "", key_id = "", team_id = "", offered = false }
}

variable "google_client_id" {
  description = "The Google OAuth client id; empty keeps sign-in off. The secret is not here -- see sign-in.tf."
  type        = string
}

variable "table_name" {
  description = "The Go backend's table, when switched to a restored one; empty for its own."
  type        = string
}

variable "table_point_in_time_recovery" {
  description = "Whether the Go backend's table keeps point-in-time recovery (#553)."
  type        = bool
}

variable "monitoring_endpoint" {
  description = "The monitoring server the logs are sent on to (#508), or empty for none."
  type        = string
  default     = ""
}
