# The same bucket as the environments, under its own key. No lock table: the S3 backend takes
# its lock from the bucket. See ../README.md for the one-off bootstrap.
terraform {
  backend "s3" {
    bucket       = "todolist-tofu-state"
    key          = "account/terraform.tfstate"
    region       = "eu-central-1"
    encrypt      = true
    use_lockfile = true
  }
}
