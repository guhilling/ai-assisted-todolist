# Task attachments (#204): the files people attach to their tasks, in a private bucket of this
# environment's own.
#
# The browser moves the content itself, straight to and from S3, through links the backend signs
# for one object and a few minutes (doc/decisions/domain-and-backend.md). So the bucket needs
# exactly two things beyond being private: a CORS rule letting this environment's site PUT to it,
# and a task role allowed to sign those links -- a presigned URL can do no more than the identity
# that signed it.
#
# Foundation rather than billable.tf, because it is people's data: `env.sh down` keeps it, like the
# database's final snapshot, and the next `up` finds every file where it was. At demo sizes -- five
# files of at most 10 MB a user -- it costs fractions of a cent a month.

locals {
  attachments_bucket = "${local.name}-attachments"
}

# Suppressed, each for a reason that holds on this bucket:
#
# - AWS-0089, access logging: would need another bucket. Access is the backend's, logged by it.
# - AWS-0090, versioning: deliberately off. Removing an attachment, or a task's attachments once
#   the undo window has passed, must really delete the file; a noncurrent version would keep a
#   copy nobody can see or remove from the application, which the privacy policy would then have
#   to explain.
# - AWS-0132, a customer-managed KMS key, is suppressed on the encryption configuration below.
#trivy:ignore:AWS-0089
#trivy:ignore:AWS-0090
resource "aws_s3_bucket" "attachments" {
  bucket = local.attachments_bucket

  tags = { Name = local.attachments_bucket }
}

resource "aws_s3_bucket_public_access_block" "attachments" {
  bucket = aws_s3_bucket.attachments.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "attachments" {
  bucket = aws_s3_bucket.attachments.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# AWS-0132: S3-managed keys. A customer-managed key costs a dollar a month per environment and
# protects against nothing here that the bucket policy does not: only the task role can sign.
#trivy:ignore:AWS-0132
resource "aws_s3_bucket_server_side_encryption_configuration" "attachments" {
  bucket = aws_s3_bucket.attachments.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# The site PUTs an upload and may fetch a file, cross-origin. Only Content-Type is asked for: it
# is the one signed header the browser sends itself rather than computing (Host and
# Content-Length it sets on its own, and may not be told to).
resource "aws_s3_bucket_cors_configuration" "attachments" {
  bucket = aws_s3_bucket.attachments.id

  cors_rule {
    allowed_origins = ["https://${var.hostname}"]
    allowed_methods = ["PUT", "GET"]
    allowed_headers = ["Content-Type"]
    max_age_seconds = 3600
  }
}

data "aws_iam_policy_document" "attachments_bucket" {
  statement {
    sid     = "DenyWithoutTls"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.attachments.arn,
      "${aws_s3_bucket.attachments.arn}/*",
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

resource "aws_s3_bucket_policy" "attachments" {
  bucket = aws_s3_bucket.attachments.id
  policy = data.aws_iam_policy_document.attachments_bucket.json

  # A policy written before the public access block can be refused as public.
  depends_on = [aws_s3_bucket_public_access_block.attachments]
}

# What the backend signs links with, deletes with, and lists. ListBucket does two jobs: the orphan
# clean-up (#208) lists the bucket daily, and without it S3 answers a HEAD on a missing object with
# 403 instead of 404, so "not uploaded yet" -- the confirm the browser sends too early -- would
# become a server error. Narrowing it breaks both, and LocalStack, which enforces no IAM, would not
# notice.
data "aws_iam_policy_document" "task_attachments" {
  statement {
    sid       = "ReadWriteAndDeleteAttachments"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.attachments.arn}/*"]
  }

  statement {
    sid       = "ListForTheCleanUpAndTellMissingFromForbidden"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.attachments.arn]
  }
}

resource "aws_iam_role_policy" "task_attachments" {
  name   = "${local.task_role}-attachments"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task_attachments.json
}
