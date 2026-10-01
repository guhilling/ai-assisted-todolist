variable "region" {
  description = "Where to create things. IAM is global, but the provider still needs a region."
  type        = string
}

variable "project" {
  description = "Name prefix for every resource."
  type        = string
}

variable "state_bucket" {
  description = <<-EOT
    The bucket holding OpenTofu state, which the read-only group is denied the objects of:
    looking at the account never needs the state, and the state holds every attribute of every
    resource in it. Must match the `bucket` in backend.tf, which cannot reference a variable.
  EOT
  type        = string
  default     = "todolist-tofu-state"
}
