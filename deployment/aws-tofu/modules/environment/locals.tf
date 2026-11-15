# What the whole module names things by: every resource's name starts with `name`, and the account
# and region go into the ARNs policies are written with. In a file of its own since the VPC, whose
# file held it, went with the containers (#557).

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

locals {
  name    = "${var.project}-${var.environment}"
  account = data.aws_caller_identity.current.account_id
  region  = data.aws_region.current.region
}
