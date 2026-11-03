# Sending the backend's metrics and logs to the shared monitoring server (#508): VictoriaMetrics and
# VictoriaLogs on a Hetzner VM, behind Caddy with basic auth, set up in the private repository
# guhilling/monitoring. On only where monitoring_endpoint names the server; prod leaves it empty.
#
# Three containers join the backend in its task, none of them essential, so the backend serves
# whatever they do:
#   - monitoring-config writes the two collectors' configuration into a task volume and exits.
#     Fargate cannot mount a file from S3 or anywhere else, and baking it into an image would mean
#     an image of our own to build and publish; the files are deployment/monitoring/'s, the same
#     the local overlay mounts (doc/local-development/monitoring.md).
#   - fluent-bit takes the JSON log the backend sends it through Quarkus' socket handler, beside
#     the console log that still goes to CloudWatch, and posts it to VictoriaLogs.
#   - vmagent scrapes the backend's /q/metrics and remote-writes them to VictoriaMetrics.
#
# Measured on the local stack, the two collectors use about 20 MB between them, so the task keeps
# its size. The password is an SSM SecureString Gunnar creates by hand, as with the alert address
# (doc/deployment/observability.md says how); ECS injects it, so it never passes through this
# repository or OpenTofu's state.

locals {
  monitoring_enabled  = var.monitoring_endpoint != ""
  monitoring_user     = "${var.project}-${var.environment}"
  monitoring_password = "/${var.project}/${var.environment}/monitoring-password"
  monitoring_volume   = "monitoring-config"

  # The images, pinned by tag and digest; Renovate moves them (.github/renovate.json). vmagent comes
  # through ECR's quay.io cache, so Inspector scans it like the backend; the other two from ECR
  # Public, which needs no login.
  # renovate: datasource=docker depName=public.ecr.aws/docker/library/busybox
  monitoring_config_image = "public.ecr.aws/docker/library/busybox:1.37@sha256:a7dbc319b1438115a207e11930dc4bb3e643dcb3ec0bdd694bb36cd8fad289ec"
  # renovate: datasource=docker depName=public.ecr.aws/aws-observability/aws-for-fluent-bit
  fluent_bit_image = "public.ecr.aws/aws-observability/aws-for-fluent-bit:3.5.6@sha256:18d825003ed02cf336fb33c9a1319e4f21381ad0140acc2e1707e04d636341fc"
  # renovate: datasource=docker depName=quay.io/victoriametrics/vmagent
  vmagent_image = "${local.account}.dkr.ecr.${local.region}.amazonaws.com/quay/victoriametrics/vmagent:v1.155.0@sha256:8e3c03905be15bba8312d4868e8ae6f9fc2fefee0a41d544472034249ca42bb4"

  # What the backend container gets on top of its own environment: a second log handler, sending
  # the same JSON as the console's to fluent-bit, in the same task.
  monitoring_backend_environment = slice([
    { name = "QUARKUS_LOG_SOCKET_ENABLED", value = "true" },
    { name = "QUARKUS_LOG_SOCKET_ENDPOINT", value = "localhost:5170" },
    { name = "QUARKUS_LOG_SOCKET_JSON_ENABLED", value = "true" },
  ], 0, local.monitoring_enabled ? 3 : 0)

  monitoring_mount = [{ sourceVolume = local.monitoring_volume, containerPath = "/monitoring" }]

  # The three containers' definitions differ in shape, so a conditional between them and an empty
  # list would not type-check; slice keeps all or none.
  monitoring_containers = slice([
    {
      name       = "monitoring-config"
      image      = local.monitoring_config_image
      essential  = false
      entryPoint = ["sh", "-c"]
      command = [
        "printf '%s' \"$FLUENT_BIT_CONFIG\" > /monitoring/fluent-bit.yaml && printf '%s' \"$VMAGENT_SCRAPE_CONFIG\" > /monitoring/vmagent-scrape.yaml",
      ]
      environment = [
        { name = "FLUENT_BIT_CONFIG", value = file("${path.module}/../../../monitoring/fluent-bit.yaml") },
        { name = "VMAGENT_SCRAPE_CONFIG", value = file("${path.module}/../../../monitoring/vmagent-scrape.yaml") },
      ]
      mountPoints      = local.monitoring_mount
      logConfiguration = local.ecs_log_configuration
    },
    {
      name        = "fluent-bit"
      image       = local.fluent_bit_image
      essential   = false
      entryPoint  = ["/fluent-bit/bin/fluent-bit"]
      command     = ["-c", "/monitoring/fluent-bit.yaml"]
      dependsOn   = [{ containerName = "monitoring-config", condition = "SUCCESS" }]
      mountPoints = local.monitoring_mount
      environment = [
        { name = "MONITORING_HOST", value = var.monitoring_endpoint },
        { name = "MONITORING_PORT", value = "443" },
        { name = "MONITORING_TLS", value = "on" },
        { name = "MONITORING_USER", value = local.monitoring_user },
        { name = "MONITORING_ENV", value = var.environment },
      ]
      secrets          = [{ name = "MONITORING_PASSWORD", valueFrom = local.monitoring_password_arn }]
      logConfiguration = local.ecs_log_configuration
    },
    {
      name      = "vmagent"
      image     = local.vmagent_image
      essential = false
      command = [
        "-promscrape.config=/monitoring/vmagent-scrape.yaml",
        "-remoteWrite.url=https://${var.monitoring_endpoint}/api/v1/write",
        "-remoteWrite.basicAuth.username=${local.monitoring_user}",
        "-remoteWrite.label=project=${var.project}",
        "-remoteWrite.label=env=${var.environment}",
        # The password comes from the environment, as remoteWrite_basicAuth_password, rather than
        # the command line, where the task definition would show it.
        "-envflag.enable",
        # Its buffer for when the server cannot be reached, kept small: the task's disk is shared.
        "-remoteWrite.maxDiskUsagePerURL=100MB",
      ]
      dependsOn   = [{ containerName = "monitoring-config", condition = "SUCCESS" }]
      mountPoints = local.monitoring_mount
      environment = [{ name = "BACKEND_TARGET", value = "localhost:${var.backend_port}" }]
      secrets = [
        { name = "remoteWrite_basicAuth_password", valueFrom = local.monitoring_password_arn },
      ]
      logConfiguration = local.ecs_log_configuration
    },
  ], 0, local.monitoring_enabled ? 3 : 0)

  # The password parameter's ARN, null where monitoring is off.
  monitoring_password_arn = one(data.aws_ssm_parameter.monitoring_password[*].arn)
}

# The password's parameter, looked up so that a plan fails while it is missing rather than every
# task failing to start. Read without decryption: the state holds only the ciphertext.
data "aws_ssm_parameter" "monitoring_password" {
  count = local.monitoring_enabled ? 1 : 0

  name            = local.monitoring_password
  with_decryption = false
}
