# Who may talk to whom. Each group names exactly one source, so the path in is a single line:
# CloudFront -> load balancer -> task -> database, and nothing may skip a step.
#
# The rules are aws_vpc_security_group_{ingress,egress}_rule rather than the older
# aws_security_group_rule. One rule per resource is the provider's current recommendation and it
# is the version that has a stable identity: the legacy resource keys rules by their contents, so
# editing a port destroys and recreates the rule, and mixing it with inline rules silently
# reverts them. Note also that AWS restricts what a description may contain -- no apostrophes,
# among other things -- and rejects the plan rather than the apply if one appears.

# CloudFront's origin-facing addresses, as a managed prefix list rather than a hardcoded range.
# AWS keeps it current; hardcoding it would rot.
data "aws_ec2_managed_prefix_list" "cloudfront_origin_facing" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Internal load balancer: reachable from CloudFront only"
  vpc_id      = aws_vpc.this.id

  tags = { Name = "${local.name}-alb" }
}

# The load balancer has no public address at all -- CloudFront reaches it through a VPC origin.
# This still restricts the source, so that nothing else inside the VPC can reach it either.
#
# TO VERIFY before the first apply: that VPC-origin traffic does arrive from this prefix list.
# doc/deployment.md lists it as an open question; if it does not, the source becomes the VPC
# CIDR and this comment goes away.
resource "aws_vpc_security_group_ingress_rule" "alb_from_cloudfront" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS from the CloudFront origin-facing ranges"

  ip_protocol    = "tcp"
  from_port      = 443
  to_port        = 443
  prefix_list_id = data.aws_ec2_managed_prefix_list.cloudfront_origin_facing.id
}

resource "aws_vpc_security_group_egress_rule" "alb_to_tasks" {
  security_group_id = aws_security_group.alb.id
  description       = "Forward to the backend tasks"

  ip_protocol                  = "tcp"
  from_port                    = var.backend_port
  to_port                      = var.backend_port
  referenced_security_group_id = aws_security_group.tasks.id
}

resource "aws_security_group" "tasks" {
  name        = "${local.name}-tasks"
  description = "Backend tasks: reachable from the load balancer only, despite the public IP"
  vpc_id      = aws_vpc.this.id

  tags = { Name = "${local.name}-tasks" }
}

# The tasks have a public IP so they can make outbound calls. This is the rule that means the
# public IP does not make them reachable: the only thing that may open a connection to them is
# the load balancer.
resource "aws_vpc_security_group_ingress_rule" "tasks_from_alb" {
  security_group_id = aws_security_group.tasks.id
  description       = "Only the load balancer may reach the backend"

  ip_protocol                  = "tcp"
  from_port                    = var.backend_port
  to_port                      = var.backend_port
  referenced_security_group_id = aws_security_group.alb.id
}

# Outbound is open because the task legitimately needs the internet: the image registry, the
# identity provider token endpoint, and Gravatar. Narrowing it would mean a NAT gateway or VPC
# endpoints, which doc/decisions.md rejected on cost for a demo.
#
# ip_protocol "-1" means every protocol, and the ports must then be left unset rather than set
# to 0 -- the provider rejects a port range on an all-protocols rule.
resource "aws_vpc_security_group_egress_rule" "tasks_egress" {
  security_group_id = aws_security_group.tasks.id
  description       = "Image registry, identity provider, Gravatar"

  ip_protocol = "-1"
  cidr_ipv4   = "0.0.0.0/0"
}

resource "aws_security_group" "database" {
  name        = "${local.name}-database"
  description = "PostgreSQL: reachable from the backend tasks only"
  vpc_id      = aws_vpc.this.id

  tags = { Name = "${local.name}-database" }
}

resource "aws_vpc_security_group_ingress_rule" "database_from_tasks" {
  security_group_id = aws_security_group.database.id
  description       = "Only the backend may reach the database"

  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.tasks.id
}
