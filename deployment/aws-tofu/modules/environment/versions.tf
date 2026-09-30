terraform {
  # OpenTofu, not Terraform. ../../README.md says why and what it changes; the block is still
  # called `terraform` because OpenTofu kept the language identical.
  #
  # Two features set the floor at 1.10, and both are load-bearing rather than incidental:
  #
  #   1.8   variables are evaluated early enough to be used in a backend block, which is what
  #         lets the two environment roots share one byte-identical backend.tf
  #   1.10  the S3 backend can take its lock from S3 itself, so there is no DynamoDB table to
  #         create, pay for or forget
  #
  # On Terraform neither is available: backend blocks evaluate nothing, and its S3 lock is the
  # DynamoDB table.
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
