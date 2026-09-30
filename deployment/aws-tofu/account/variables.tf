variable "region" {
  description = "Where to create things. IAM is global, but the provider still needs a region."
  type        = string
}

variable "project" {
  description = "Name prefix for every resource."
  type        = string
}
