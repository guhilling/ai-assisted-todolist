# Everything that costs money while it exists.
#
# This file is separate so that "what does this environment cost when it is up?" has one answer
# you can read, and so the rule below has somewhere to apply.
#
# **Every resource in this file carries `count = var.running ? 1 : 0`.** That is what makes
# tearing an environment down a parameter change rather than a `tofu destroy` that has to be
# aimed carefully. It is checked, not remembered: `check-billable-guard.py` fails the build on a
# resource here without the guard, because the failure mode otherwise is silent -- teardown
# simply leaves that resource running, and the first evidence is the bill.
#
# Referring to a guarded resource means indexing it, `aws_db_instance.this[0].endpoint`, or using
# `one(aws_db_instance.this)` where a null is acceptable.
#
# The load balancer and its target groups, and the ECS service, arrive in the changes that add
# them.

# PostgreSQL on RDS, single-AZ and the smallest Graviton class: demo scale, and high availability
# is explicitly not a goal. About $13 a month for the instance and $3 for 20 GB of gp3 in
# eu-central-1, for as long as `running` is true and not a cent longer.
#
# Teardown is a destroy with a final snapshot, and `env.sh up` restores the newest one, so data
# survives a down/up cycle -- the instance does not. Two consequences are handled below:
#
# - The snapshot name must be new each time, or the second teardown would collide with the
#   first. It is stamped when the instance is created and then frozen by ignore_changes, so each
#   instance carries its own name to its own destroy.
# - Which snapshot an instance was restored from is only meaningful at creation. Frozen too, or
#   every later `up` naming a newer snapshot would plan to replace a running database.
# Two Trivy findings are suppressed here, each for the reason given beside its setting below:
# AWS-0177 (deletion protection) and AWS-0078 (a customer-managed key for Performance Insights).
#trivy:ignore:AWS-0177
#trivy:ignore:AWS-0078
resource "aws_db_instance" "this" {
  count = var.running ? 1 : 0

  identifier     = local.db_instance
  engine         = local.db_engine
  engine_version = local.db_engine_major

  instance_class    = "db.t4g.micro"
  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = local.db_name
  username = "${var.project}_admin"

  # RDS generates the master password, keeps it in Secrets Manager and rotates it every seven
  # days. It never enters state, and the application never uses it -- see database.tf.
  manage_master_user_password = true

  # The application's way in. A token signed from the task role per connection, checked against
  # IAM; RDS for PostgreSQL 18 already refuses non-TLS connections by default (rds.force_ssl).
  iam_database_authentication_enabled = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = false
  multi_az               = false

  # A week of point-in-time recovery while the environment is up -- still free, because RDS
  # includes backup storage up to the instance's allocated 20 GB and a week of this database is
  # far less. Automated backups go with the instance; the final snapshot is what survives a
  # teardown.
  backup_retention_period = 7
  copy_tags_to_snapshot   = true

  auto_minor_version_upgrade = true

  # The free tier: seven days of query-level load history, which is what shows a slow request
  # was the database and not the application. Encrypted with the AWS-managed key; a
  # customer-managed one (AWS-0078) is about $1 a month, more than this history is worth here.
  performance_insights_enabled          = true
  performance_insights_retention_period = 7

  # Off, and it has to be: teardown is this resource being destroyed, and deletion protection
  # would make every `env.sh down` fail. The final snapshot is the protection instead. That is
  # what Trivy reports as AWS-0177, suppressed for this reason on the resource above.
  deletion_protection       = false
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.db_instance}-final-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  snapshot_identifier       = var.db_restore_snapshot

  tags = { Name = local.db_instance }

  lifecycle {
    ignore_changes = [final_snapshot_identifier, snapshot_identifier]
  }
}
