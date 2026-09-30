# State lives in one bucket with a key per environment, and a lock table shared by both.
# Both are created once, by hand, before the first init -- see README.md. Terraform cannot
# create the backend it is about to use.
#
# This is the only file besides terraform.tfvars that differs between the environments, and it
# differs in one line: the key.
terraform {
  backend "s3" {
    bucket         = "todolist-terraform-state"
    key            = "prod/terraform.tfstate"
    region         = "eu-central-1"
    dynamodb_table = "todolist-terraform-locks"
    encrypt        = true
  }
}
