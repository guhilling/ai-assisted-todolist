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

locals {
  # What both one-off tasks need to reach the database, while it exists.
  db_address = one(aws_db_instance.this[*].address)
  db_port    = one(aws_db_instance.this[*].port)

  ecs_log_configuration = {
    logDriver = "awslogs"
    options = {
      awslogs-group         = aws_cloudwatch_log_group.ecs.name
      awslogs-region        = local.region
      awslogs-stream-prefix = "task"
    }
  }
}

# Creates taskfest_<env> in the database, once. `./env.sh db-bootstrap <env>` runs it.
#
# The only place the master credentials are ever used, and the only task that receives them:
# ECS injects them from the RDS-managed secret when the task starts, so a rotation since the last
# run does not matter. The long-running service never has them -- see doc/deployment/database.md.
#
# psql verifies the server against the region's RDS CA bundle, passed in as a variable because
# the postgres image does not carry it, and written to a file because libpq wants a path. The
# shell line does nothing else; the SQL is in db-bootstrap.sql and reaches psql on stdin, which
# is where psql interpolates :app_user (it does not inside -c).
resource "aws_ecs_task_definition" "db_bootstrap" {
  count = var.running ? 1 : 0

  family                   = local.db_bootstrap_family
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.task_execution.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = "db-bootstrap"
    image     = "public.ecr.aws/docker/library/postgres:${local.db_engine_major}-alpine"
    essential = true

    entryPoint = ["sh", "-c"]
    command = [
      "printf '%s\\n' \"$RDS_CA_BUNDLE\" > /tmp/rds-ca.pem && printf '%s\\n' \"$BOOTSTRAP_SQL\" | psql -v ON_ERROR_STOP=1 -v app_user=\"$APP_USER\" -f -",
    ]

    environment = [
      { name = "PGHOST", value = local.db_address },
      { name = "PGPORT", value = tostring(local.db_port) },
      { name = "PGDATABASE", value = local.db_name },
      { name = "PGSSLMODE", value = "verify-full" },
      { name = "PGSSLROOTCERT", value = "/tmp/rds-ca.pem" },
      { name = "APP_USER", value = local.db_app_user },
      { name = "RDS_CA_BUNDLE", value = file("${path.module}/rds-ca/${local.region}-bundle.pem") },
      { name = "BOOTSTRAP_SQL", value = file("${path.module}/db-bootstrap.sql") },
    ]

    secrets = [
      { name = "PGUSER", valueFrom = "${one(aws_db_instance.this[*].master_user_secret[0].secret_arn)}:username::" },
      { name = "PGPASSWORD", valueFrom = "${one(aws_db_instance.this[*].master_user_secret[0].secret_arn)}:password::" },
    ]

    logConfiguration = local.ecs_log_configuration
  }])

  tags = { Name = local.db_bootstrap_family }
}

# Liquibase, over IAM authentication, then exit. `./env.sh migrate <env>` runs it.
#
# The backend image with `quarkus.init-and-exit`: Quarkus runs its start-up tasks -- Liquibase
# among them, switched on here -- and stops instead of serving. It logs in exactly as the
# application will, which is what makes a successful run the proof that the user exists, the
# token is accepted and verify-full holds. The CA bundle is the one baked into the image under
# /opt/rds by backend/src/main/jib.
resource "aws_ecs_task_definition" "migrate" {
  count = var.running ? 1 : 0

  family                   = local.migrate_family
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = "migrate"
    image     = local.backend_image
    essential = true

    environment = [
      { name = "QUARKUS_INIT_AND_EXIT", value = "true" },
      { name = "QUARKUS_LIQUIBASE_MIGRATE_AT_START", value = "true" },
      {
        name  = "QUARKUS_DATASOURCE_JDBC_URL"
        value = "jdbc:postgresql://${local.db_address}:${local.db_port}/${local.db_name}?sslmode=verify-full&sslrootcert=/opt/rds/global-bundle.pem"
      },
      { name = "QUARKUS_DATASOURCE_USERNAME", value = local.db_app_user },
      { name = "TASKFEST_DATASOURCE_CREDENTIALS_PROVIDER", value = "rds-iam" },
      { name = "AWS_REGION", value = local.region },
    ]

    logConfiguration = local.ecs_log_configuration
  }])

  tags = { Name = local.migrate_family }

  lifecycle {
    # env.sh up always passes the release; a plan without it would start whatever `latest` the
    # ECR cache holds, possibly a day old. Fail loudly instead -- see variables.tf.
    precondition {
      condition     = var.backend_image != null
      error_message = "backend_image is required while the environment is up: run ./env.sh up, or pass -var backend_image=<the image env.sh up prints>."
    }
  }
}

# The internal load balancer: no public address, in the private subnets, reachable only through
# the CloudFront VPC origin below. About $20 a month while it exists, which is why it is here.
# Deletion protection is off for the database's reason: it would make every `down` fail.
resource "aws_lb" "this" {
  count = var.running ? 1 : 0

  name               = local.alb_name
  load_balancer_type = "application"
  internal           = true
  subnets            = aws_subnet.private[*].id
  security_groups    = [aws_security_group.alb.id]

  drop_invalid_header_fields = true
  enable_deletion_protection = false

  tags = { Name = local.alb_name }
}

# Blue and green: ECS keeps the running version in one and starts the next in the other, then
# moves the listener rule across. Which is which at any moment is ECS's business.
resource "aws_lb_target_group" "blue" {
  count = var.running ? 1 : 0

  name        = "${local.name}-blue"
  vpc_id      = aws_vpc.this.id
  target_type = "ip"
  protocol    = "HTTP"
  port        = var.backend_port

  # How long a target leaving the group keeps its open connections: the last phase of every
  # blue/green rollout waits on it. Per environment -- seconds in qa, where nobody is mid-request
  # during a deploy; longer in prod. AWS's default is five minutes.
  deregistration_delay = var.deregistration_delay_seconds

  health_check {
    path    = "/q/health/ready"
    matcher = "200"
    # Every 10 s rather than 15: a new task becomes eligible for traffic sooner. Free -- the
    # load balancer does not charge for health checks, and the backend logs no request lines.
    interval            = 10
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Name = "${local.name}-blue" }
}

# Identical to blue; two resources rather than a for_each, because check-billable-guard.py
# accepts the guard only in its literal form.
resource "aws_lb_target_group" "green" {
  count = var.running ? 1 : 0

  name        = "${local.name}-green"
  vpc_id      = aws_vpc.this.id
  target_type = "ip"
  protocol    = "HTTP"
  port        = var.backend_port

  # How long a target leaving the group keeps its open connections: the last phase of every
  # blue/green rollout waits on it. Per environment -- seconds in qa, where nobody is mid-request
  # during a deploy; longer in prod. AWS's default is five minutes.
  deregistration_delay = var.deregistration_delay_seconds

  health_check {
    path    = "/q/health/ready"
    matcher = "200"
    # Every 10 s rather than 15: a new task becomes eligible for traffic sooner. Free -- the
    # load balancer does not charge for health checks, and the backend logs no request lines.
    interval            = 10
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Name = "${local.name}-green" }
}

# TLS from CloudFront, with this region's certificate for the environment's own name: /api/*
# forwards the viewer's Host header, and CloudFront checks the origin certificate against it.
resource "aws_lb_listener" "https" {
  count = var.running ? 1 : 0

  load_balancer_arn = aws_lb.this[0].arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.origin.certificate_arn

  # Anything no rule matches. The rule below matches everything, so this is only reached if it
  # is missing -- and a 404 says so rather than reaching the backend by a back door.
  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      status_code  = "404"
      message_body = "No route"
    }
  }

  tags = { Name = local.alb_name }
}

# The production rule ECS moves between blue and green. Blue/green needs a rule rather than the
# listener's default action, and ECS rewrites its weights on every deployment -- so the forward
# action is ignored after creation, or every plan would try to put back whatever it first saw.
resource "aws_lb_listener_rule" "production" {
  count = var.running ? 1 : 0

  listener_arn = aws_lb_listener.https[0].arn
  priority     = 100

  action {
    type = "forward"

    forward {
      target_group {
        arn    = aws_lb_target_group.blue[0].arn
        weight = 100
      }

      target_group {
        arn    = aws_lb_target_group.green[0].arn
        weight = 0
      }
    }
  }

  condition {
    path_pattern {
      values = ["/*"]
    }
  }

  tags = { Name = "${local.alb_name}-production" }

  lifecycle {
    ignore_changes = [action]
  }
}

# The long-running backend. Same image and the same IAM database login as `migrate`, but it
# serves instead of exiting, and it never migrates: the schema changes only through the migrate
# task, so that a deployment with a migration can take the downtime it needs (doc/deployment/deploying.md).
resource "aws_ecs_task_definition" "backend" {
  count = var.running ? 1 : 0

  family                   = local.service_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = "backend"
    image     = local.backend_image
    essential = true

    portMappings = [{ containerPort = var.backend_port, protocol = "tcp" }]

    environment = concat([
      { name = "QUARKUS_LIQUIBASE_MIGRATE_AT_START", value = "false" },
      {
        name  = "QUARKUS_DATASOURCE_JDBC_URL"
        value = "jdbc:postgresql://${local.db_address}:${local.db_port}/${local.db_name}?sslmode=verify-full&sslrootcert=/opt/rds/global-bundle.pem"
      },
      { name = "QUARKUS_DATASOURCE_USERNAME", value = local.db_app_user },
      { name = "TASKFEST_DATASOURCE_CREDENTIALS_PROVIDER", value = "rds-iam" },
      { name = "AWS_REGION", value = local.region },

      # Where task attachments go (attachments.tf).
      { name = "TASKFEST_ATTACHMENTS_BUCKET", value = local.attachments_bucket },

      # Whose snapshots decide how long an account deletion record is kept (#213).
      { name = "TASKFEST_ACCOUNT_DB_INSTANCE", value = local.db_instance },

      # Sign-in with Google (sign-in.tf), on only where a client id is configured.
      { name = "TASKFEST_AUTH_ENABLED", value = tostring(local.sign_in_enabled) },
      { name = "TASKFEST_OIDC_GOOGLE_CLIENT_ID", value = var.google_client_id },

      # Behind CloudFront and the load balancer, which talks to the task over plain HTTP. The
      # backend builds the OIDC callback address from the request, so it must believe the load
      # balancer's X-Forwarded-Proto -- otherwise it asks Google to return to http://, which
      # Google refuses. Believed only from inside the VPC; nothing else can reach the task anyway.
      # SignInBehindProxyTest pins this with the same keys.
      { name = "QUARKUS_HTTP_PROXY_PROXY_ADDRESS_FORWARDING", value = "true" },
      { name = "QUARKUS_HTTP_PROXY_ALLOW_X_FORWARDED", value = "true" },
      { name = "QUARKUS_HTTP_PROXY_TRUSTED_PROXIES", value = var.vpc_cidr },
      ], var.test_sign_in ? [
      # The test accounts' provider (test-sign-in.tf), declared in application.properties and
      # switched on here, where the pool exists.
      { name = "TASKFEST_OIDC_COGNITO_ENABLED", value = "true" },
      { name = "TASKFEST_OIDC_COGNITO_ISSUER", value = "https://${aws_cognito_user_pool.test_accounts[0].endpoint}" },
      { name = "TASKFEST_OIDC_COGNITO_CLIENT_ID", value = aws_cognito_user_pool_client.backend[0].id },
    ] : [])

    secrets = concat(local.sign_in_enabled ? [
      { name = "TASKFEST_OIDC_GOOGLE_CLIENT_SECRET", valueFrom = aws_secretsmanager_secret.google_client_secret.arn },
      ] : [], var.test_sign_in ? [
      { name = "TASKFEST_OIDC_COGNITO_CLIENT_SECRET", valueFrom = aws_ssm_parameter.test_client_secret[0].arn },
    ] : [])

    logConfiguration = local.ecs_log_configuration
  }])

  tags = { Name = local.service_name }

  lifecycle {
    # env.sh up always passes the release; a plan without it would start whatever `latest` the
    # ECR cache holds, possibly a day old. Fail loudly instead -- see variables.tf.
    precondition {
      condition     = var.backend_image != null
      error_message = "backend_image is required while the environment is up: run ./env.sh up, or pass -var backend_image=<the image env.sh up prints>."
    }
  }
}

# How many backend tasks serve once the environment is up. The service is created with none:
# `env.sh up` migrates the database first and then scales to this, so a release is never started
# against a schema it does not expect -- Hibernate's validation would stop every task, and the
# circuit breaker would fail the service's very first deployment.
locals {
  backend_task_count = 1
}

resource "aws_ecs_service" "backend" {
  count = var.running ? 1 : 0

  name            = local.service_name
  cluster         = aws_ecs_cluster.this.arn
  task_definition = aws_ecs_task_definition.backend[0].arn
  desired_count   = 0
  launch_type     = "FARGATE"

  # Long enough for the JVM to start and the first readiness check to pass; until then a
  # failing health check does not count against the task.
  health_check_grace_period_seconds = 60

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = true
  }

  # Both versions keep running for the bake time after traffic has moved, so that a bad release
  # can be rolled back by moving it straight back -- per environment, because qa is redeployed
  # often and waited on, while prod is where a quick way back matters. The circuit breaker rolls
  # back a deployment whose tasks never become healthy.
  deployment_configuration {
    strategy             = "BLUE_GREEN"
    bake_time_in_minutes = var.blue_green_bake_minutes
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.blue[0].arn
    container_name   = "backend"
    container_port   = var.backend_port

    advanced_configuration {
      alternate_target_group_arn = aws_lb_target_group.green[0].arn
      production_listener_rule   = aws_lb_listener_rule.production[0].arn
      role_arn                   = aws_iam_role.ecs_infrastructure.arn
    }
  }

  # With no tasks yet, steady as soon as it exists; `env.sh up` waits for the scaled service.
  wait_for_steady_state = true

  tags = { Name = local.service_name }

  # After a blue/green deployment the live target group is whichever ECS last shifted to, so the
  # one named here stops being true; the deploy story will also register task definitions this
  # file never sees. The task count is env.sh's once the service exists, so an apply to a running
  # environment never scales it back to none.
  lifecycle {
    ignore_changes = [load_balancer, task_definition, desired_count]
  }
}

# The /api/* origin: CloudFront's private path into the VPC to the internal load balancer. It
# names the load balancer's ARN, so it is created and destroyed with it, and the distribution in
# edge.tf adds and drops its /api/* behaviour accordingly.
resource "aws_cloudfront_vpc_origin" "api" {
  count = var.running ? 1 : 0

  vpc_origin_endpoint_config {
    name                   = local.alb_name
    arn                    = aws_lb.this[0].arn
    http_port              = 80
    https_port             = 443
    origin_protocol_policy = "https-only"

    origin_ssl_protocols {
      items    = ["TLSv1.2"]
      quantity = 1
    }
  }

  tags = { Name = local.alb_name }

  # Delete only after the distribution has let go of it. Without this, OpenTofu orders the
  # deletion before the distribution's update -- the update waits for the delete, as `tofu graph`
  # shows -- and CloudFront refuses to delete a VPC origin a distribution still uses
  # (CannotDeleteEntityWhileInUse, which the first `down` of qa hit). create_before_destroy
  # reverses that edge: the distribution is updated first, then the origin goes.
  #
  # For an origin that already exists, the setting only counts once the state records it, which
  # takes one apply that keeps the origin (running = true). A `down` planned straight from a state
  # written without it still orders the deletion first -- reproduced with terraform_data, and
  # visible in `tofu graph -type=apply` as the distribution waiting on the load balancer's destroy.
  #
  # OpenTofu passes create_before_destroy on to what this depends on, i.e. the load balancer. A
  # change that *replaces* the load balancer would then try to create a second one under the same
  # name and fail; take the environment down and up instead of replacing it in place.
  lifecycle {
    create_before_destroy = true
  }
}
