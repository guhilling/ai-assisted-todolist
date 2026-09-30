# State lives in one bucket with a key per environment, and a lock table shared by both. Both
# are created once, by hand, before the first init -- see ../../README.md. No tool can create
# the backend it is about to use.
#
# The key is interpolated from var.environment, which is what makes this file identical in every
# environment root. That needs OpenTofu 1.8 or newer: Terraform evaluates nothing in a backend
# block, so there the key has to be written out per environment and becomes one more thing that
# can drift. It is the one concrete reason this project is on OpenTofu rather than Terraform.
terraform {
  backend "s3" {
    bucket       = "todolist-tofu-state"
    key          = "${var.environment}/terraform.tfstate"
    region       = "eu-central-1"
    encrypt      = true
    use_lockfile = true
  }
}
