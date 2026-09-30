output "github_oidc_provider_arn" {
  description = "The OIDC provider each environment's deploy role trusts."
  value       = aws_iam_openid_connect_provider.github.arn
}

output "monitoring_user_name" {
  description = "The read-only user. Its access key, if one is wanted, is created by hand."
  value       = aws_iam_user.monitoring.name
}
