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
