# The way in: the environment's name, its certificates, and the CloudFront distribution that
# answers on it. All of it is free while nobody uses it, so it is foundation and survives
# `env.sh down` -- except the one part that cannot: the /api/* origin.
#
# That origin is a CloudFront VPC origin pointing at the internal load balancer, and a VPC origin
# names one load balancer ARN and cannot be changed or deleted while a distribution uses it. The
# load balancer is destroyed on every `down`, so the distribution drops its /api/* origin and
# behaviour then, and gains them again on `up`, around a VPC origin created in billable.tf. That
# costs up to ~15-20 minutes on each, and is the price of a `down` that costs nothing; keeping
# the load balancer up instead would cost ~$20 a month. See doc/decisions.md.
#
# While the environment is down the distribution still answers, from the site bucket only.

data "aws_route53_zone" "this" {
  name = var.dns_zone
}

# Two certificates for the same name. The viewer certificate has to be in us-east-1 for
# CloudFront; the load balancer needs its own in this region. Both are free, and both validate
# through the same DNS record: ACM creates the record "specifically for your domain and your
# account", and the token "works for any AWS Region" (ACM user guide, DNS validation).
resource "aws_acm_certificate" "viewer" {
  provider = aws.us_east_1

  domain_name       = var.hostname
  validation_method = "DNS"

  tags = { Name = "${local.name}-viewer" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate" "origin" {
  domain_name       = var.hostname
  validation_method = "DNS"

  tags = { Name = "${local.name}-origin" }

  lifecycle {
    create_before_destroy = true
  }
}

# One record, without for_each, because there is one name. An earlier version keyed a for_each
# by the record's name, which ACM only generates once the certificate exists -- and for_each
# needs its keys at plan time, so the very first plan failed. The name and value can be unknown
# while planning; only the number of instances cannot.
locals {
  certificate_validation = one(aws_acm_certificate.viewer.domain_validation_options)
}

resource "aws_route53_record" "certificate_validation" {
  zone_id = data.aws_route53_zone.this.zone_id
  name    = local.certificate_validation.resource_record_name
  type    = local.certificate_validation.resource_record_type
  records = [local.certificate_validation.resource_record_value]
  ttl     = 300

  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "viewer" {
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.viewer.arn
  validation_record_fqdns = [aws_route53_record.certificate_validation.fqdn]
}

resource "aws_acm_certificate_validation" "origin" {
  certificate_arn         = aws_acm_certificate.origin.arn
  validation_record_fqdns = [aws_route53_record.certificate_validation.fqdn]
}

# The site bucket: private, reachable only through this distribution's origin access control.
# It is the distribution's default origin because a distribution must have one, and this is the
# one it keeps. A release's frontend build is synced into it by deploy-frontend.yml, with the
# deploy role -- see doc/deployment.md.
#
# Suppressed for the reasons the flow-log bucket gives: AWS-0089 (access logging would need
# another bucket), AWS-0090 (versioning: a release is rolled back by syncing the previous one,
# not by object versions -- see doc/deployment.md), AWS-0132 on the encryption below.
#trivy:ignore:AWS-0089
#trivy:ignore:AWS-0090
resource "aws_s3_bucket" "site" {
  bucket = local.site_bucket

  tags = { Name = local.site_bucket }
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# AWS-0132: S3-managed keys, as for the flow logs. The objects are a public website.
#trivy:ignore:AWS-0132
resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = local.site_bucket
  description                       = "CloudFront signs its requests to the ${var.environment} site bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Only this distribution may read, and only over TLS.
data "aws_iam_policy_document" "site_bucket" {
  statement {
    sid       = "ReadThroughThisDistributionOnly"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudfront_distribution.this.arn]
    }
  }

  statement {
    sid     = "DenyWithoutTls"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.site.arn,
      "${aws_s3_bucket.site.arn}/*",
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

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.site]
}

# AWS-managed policies rather than hand-written ones. For /api/*: nothing is cached, and the
# viewer's request is forwarded whole -- Host, Authorization, cookies, query string. Caching an
# API response here would be the worst failure this distribution could have: one person's
# signed-in answer served to another.
data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewer"
}

locals {
  site_origin_id = "site"
  api_origin_id  = "api"
}

# Deep links: any path whose last segment has no dot gets the app's index.html. Only on the
# default behaviour, so /api/* errors stay the backend's own -- CloudFront's custom error
# responses, the usual way, apply to every origin and would have turned them into the app.
# The code and why are in spa-routing.js, and spa-routing.test.mjs pins it (Tofu CI runs it).
# Free at this traffic: the first two million invocations a month cost nothing.
resource "aws_cloudfront_function" "spa_routing" {
  name    = "${local.name}-spa-routing"
  runtime = "cloudfront-js-2.0"
  comment = "Client-side routes get index.html; files are served as themselves"
  code    = file("${path.module}/spa-routing.js")
  publish = true
}

# Suppressed: AWS-0010, access logging -- the request log that matters is the backend's own, in
# CloudWatch, and CloudFront's standard logs would be another bucket. AWS-0011, WAF -- out of
# scope by the plan, at $5 a month plus per rule before any traffic.
#trivy:ignore:AWS-0010
#trivy:ignore:AWS-0011
resource "aws_cloudfront_distribution" "this" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${local.name}: the site, and /api/* to the backend"
  aliases         = [var.hostname]

  # North America and Europe only: the cheapest class, and where every viewer of this demo is.
  price_class = "PriceClass_100"

  origin {
    origin_id                = local.site_origin_id
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  # Only while the environment is up: see the header of this file.
  dynamic "origin" {
    for_each = aws_cloudfront_vpc_origin.api

    content {
      origin_id   = local.api_origin_id
      domain_name = one(aws_lb.this[*].dns_name)

      vpc_origin_config {
        vpc_origin_id = origin.value.id
      }
    }
  }

  default_cache_behavior {
    target_origin_id       = local.site_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
    compress               = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_routing.arn
    }
  }

  dynamic "ordered_cache_behavior" {
    for_each = aws_cloudfront_vpc_origin.api

    content {
      path_pattern             = "/api/*"
      target_origin_id         = local.api_origin_id
      viewer_protocol_policy   = "https-only"
      allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods           = ["GET", "HEAD"]
      cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
      origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
      compress                 = true
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.viewer.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = { Name = local.name }
}

resource "aws_route53_record" "alias" {
  for_each = toset(["A", "AAAA"])

  zone_id = data.aws_route53_zone.this.zone_id
  name    = var.hostname
  type    = each.key

  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}
