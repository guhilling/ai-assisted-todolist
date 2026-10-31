output "vpc_id" {
  description = "The environment's VPC."
  value       = aws_vpc.this.id
}

output "public_subnet_ids" {
  description = "Where the ECS tasks run."
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "Where the internal load balancer lives."
  value       = aws_subnet.private[*].id
}

output "alb_security_group_id" {
  description = "Attach the load balancer to this."
  value       = aws_security_group.alb.id
}

output "tasks_security_group_id" {
  description = "Attach the ECS service to this."
  value       = aws_security_group.tasks.id
}

output "database_security_group_id" {
  description = "Attach the RDS instance to this."
  value       = aws_security_group.database.id
}

output "name_prefix" {
  description = "The <project>-<environment> prefix every resource is named with."
  value       = local.name
}

output "deploy_role_arn" {
  description = "The role GitHub Actions assumes to deploy this environment. Goes in the workflow, not in a secret."
  value       = aws_iam_role.deploy.arn
}

output "lifecycle_role_arn" {
  description = "The role a person assumes, with MFA, to create or destroy what bills in this environment."
  value       = aws_iam_role.lifecycle.arn
}

output "running" {
  description = "Whether this environment's billable resources exist, as of the last apply."
  value       = var.running
}

output "db_endpoint" {
  description = "Where the database listens, host:port, or null while the environment is down."
  value       = one(aws_db_instance.this[*].endpoint)
}

output "db_app_user" {
  description = "The database user the backend logs in as, with IAM authentication rather than a password."
  value       = local.db_app_user
}

output "db_master_secret_arn" {
  description = "The RDS-managed master credentials, for bootstrapping and administration only. Null while down."
  value       = one(aws_db_instance.this[*].master_user_secret[0].secret_arn)
}

output "task_role_arn" {
  description = "What the backend container runs as."
  value       = aws_iam_role.task.arn
}

output "cluster_name" {
  description = "The ECS cluster the one-off tasks run in."
  value       = aws_ecs_cluster.this.name
}

output "backend_service_name" {
  description = "The backend's ECS service, which env.sh up scales once the database is migrated."
  value       = local.service_name
}

output "backend_task_count" {
  description = "How many backend tasks env.sh up scales the service to."
  value       = local.backend_task_count
}

output "db_bootstrap_task_family" {
  description = "The task that creates the application's database user. Run by env.sh db-bootstrap."
  value       = local.db_bootstrap_family
}

output "migrate_task_family" {
  description = "The task that runs Liquibase over IAM authentication. Run by env.sh migrate."
  value       = local.migrate_family
}

output "url" {
  description = "Where this environment answers, through CloudFront."
  value       = "https://${var.hostname}"
}

output "distribution_id" {
  description = "The CloudFront distribution, which outlives every up and down."
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
