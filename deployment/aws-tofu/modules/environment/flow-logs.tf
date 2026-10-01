# VPC flow logs: a record of every connection in and out of the VPC's network interfaces, kept
# in a bucket of this environment's own.
#
# They are part of the foundation, not of billable.tf, because what they cost follows traffic
# rather than existence: delivery is charged per GB, and a torn-down environment sends almost
# nothing. At demo traffic a running environment is cents a month.
#
# S3 rather than CloudWatch Logs because it is half the delivery price and needs no delivery
# role -- the log delivery service writes to the bucket under the bucket policy below. Reading
# them is an Athena or `aws s3 cp` job, which is the right amount of ceremony for logs looked at
# when something needs explaining rather than every day.

locals {
  flow_log_bucket = "${local.name}-flow-logs"

  # How long a record is kept. Long enough to look back over a week of demos and the incident
  # after it; short enough that storage cannot grow without bound.
  flow_log_retention_days = 30
}

# The findings suppressed here are each a second resource bought to protect the first, and none
# of them earns its place on a bucket of expiring logs:
#
# - AWS-0089, access logging: would need another bucket, whose own access logging would need
#   a third. The flow log delivery itself is recorded by CloudTrail.
# - AWS-0090, versioning: objects are written once by the delivery service and expired by the
#   lifecycle rule; versioning would keep every expired record as a noncurrent version.
# - AWS-0132, a customer-managed KMS key, is suppressed on the encryption configuration below,
#   which is where Trivy reports it.
#trivy:ignore:AWS-0089
#trivy:ignore:AWS-0090
resource "aws_s3_bucket" "flow_logs" {
  bucket = local.flow_log_bucket

  tags = { Name = local.flow_log_bucket }
}

resource "aws_s3_bucket_public_access_block" "flow_logs" {
  bucket = aws_s3_bucket.flow_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ACLs off: the bucket owner owns every object, including the ones the delivery service writes.
resource "aws_s3_bucket_ownership_controls" "flow_logs" {
  bucket = aws_s3_bucket.flow_logs.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# AWS-0132: a customer-managed KMS key costs about $1 a month per key, more than the logs
# themselves. S3-managed keys still encrypt every object at rest.
#trivy:ignore:AWS-0132
resource "aws_s3_bucket_server_side_encryption_configuration" "flow_logs" {
  bucket = aws_s3_bucket.flow_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "flow_logs" {
  bucket = aws_s3_bucket.flow_logs.id

  rule {
    id     = "expire"
    status = "Enabled"

    filter {}

    expiration {
      days = local.flow_log_retention_days
    }
  }
}

# Only the log delivery service may write, only for flow logs from this account, and only over
# TLS. Written out rather than left to AWS: given permission, creating a flow log attaches a
# policy like this one by itself, which OpenTofu would then report as drift on every plan.
data "aws_iam_policy_document" "flow_logs_bucket" {
  statement {
    sid       = "LogDeliveryWrite"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.flow_logs.arn}/AWSLogs/${local.account}/*"]

    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:logs:${local.region}:${local.account}:*"]
    }
  }

  statement {
    sid       = "LogDeliveryCheckBucket"
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.flow_logs.arn]

    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account]
    }
  }

  statement {
    sid     = "DenyWithoutTls"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.flow_logs.arn,
      "${aws_s3_bucket.flow_logs.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "flow_logs" {
  bucket = aws_s3_bucket.flow_logs.id
  policy = data.aws_iam_policy_document.flow_logs_bucket.json

  # A bucket policy on a bucket whose public access block is still being applied can be refused
  # as a public policy; ordering them avoids a first apply that fails for no visible reason.
  depends_on = [aws_s3_bucket_public_access_block.flow_logs]
}

# ALL rather than REJECT only: the question these logs exist to answer is usually "what talked to
# what", and #97 -- which traffic inside the VPC is unencrypted -- needs the accepted flows, not
# the refused ones.
resource "aws_flow_log" "vpc" {
  vpc_id               = aws_vpc.this.id
  traffic_type         = "ALL"
  log_destination_type = "s3"
  log_destination      = aws_s3_bucket.flow_logs.arn

  tags = { Name = local.name }

  depends_on = [aws_s3_bucket_policy.flow_logs]
}
