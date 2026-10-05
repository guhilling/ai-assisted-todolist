output "github_oidc_provider_arn" {
  description = "The OIDC provider each environment's deploy role trusts."
  value       = aws_iam_openid_connect_provider.github.arn
}

output "monitoring_user_name" {
  description = "The read-only user. Its access key, if one is wanted, is created by hand."
  value       = aws_iam_user.monitoring.name
}

output "image_findings_role_arn" {
  description = "The role .github/workflows/image-findings.yml assumes to read Inspector's findings."
  value       = aws_iam_role.image_findings.arn
}

output "ecr_registry" {
  description = "The registry the pull-through cache answers on; images are under quay/ there."
  value       = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.region}.amazonaws.com"
}
