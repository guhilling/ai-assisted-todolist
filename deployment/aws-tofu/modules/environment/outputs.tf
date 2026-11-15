output "name_prefix" {
  description = "The <project>-<environment> prefix every resource is named with."
  value       = local.name
}

output "deploy_role_arn" {
  description = "The role GitHub Actions assumes to deploy this environment. Goes in the workflow, not in a secret."
  value       = aws_iam_role.deploy.arn
}

output "url" {
  description = "Where this environment answers, through CloudFront."
  value       = "https://${var.hostname}"
}

output "distribution_id" {
  description = "The CloudFront distribution."
  value       = aws_cloudfront_distribution.this.id
}

output "test_accounts_user_pool_id" {
  description = "The Cognito pool of the test accounts the live tests sign in with (#190), or null where there is none."
  value       = one(aws_cognito_user_pool.test_accounts[*].id)
}

output "test_accounts_issuer" {
  description = "The test accounts' OpenID Connect issuer, which the mobile app's qa build signs in with (#267), or null where there is none."
  value       = one([for pool in aws_cognito_user_pool.test_accounts : "https://${pool.endpoint}"])
}

output "test_accounts_app_client_id" {
  description = "The mobile app's public client in the test accounts' pool (#267), or null where there is none."
  value       = one(aws_cognito_user_pool_client.app[*].id)
}
