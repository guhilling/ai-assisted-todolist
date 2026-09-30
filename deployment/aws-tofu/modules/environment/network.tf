# The network, and the two things about it that are deliberate.
#
# There is no NAT gateway. The ECS tasks sit in public subnets and take a public IP, which is
# how they reach the image registry and the identity provider; a NAT gateway would have been
# about $33 a month, more than the database. They are not reachable from outside: the security
# group in security.tf admits only the load balancer.
#
# There are private subnets all the same, for the internal load balancer. Nothing in them makes
# an outbound call, so they need no route to the internet and cost nothing.
#
# See doc/deployment.md for the reasoning and doc/decisions.md for what was rejected.

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name = "${var.project}-${var.environment}"

  # Two zones because an Application Load Balancer requires two, not for availability --
  # doc/deployment.md is explicit that HA is not a requirement here.
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

resource "aws_vpc" "this" {
  cidr_block = var.vpc_cidr

  # Both needed by ECS service discovery and by RDS's endpoint name.
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = local.name }
}

# Attached because the tasks need egress -- and, separately, because a CloudFront VPC origin
# requires the VPC to have one as a marker that it may receive traffic from CloudFront.
resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = { Name = local.name }
}

resource "aws_subnet" "public" {
  count = length(var.public_subnet_cidrs)

  vpc_id                  = aws_vpc.this.id
  cidr_block              = var.public_subnet_cidrs[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true

  tags = { Name = "${local.name}-public-${local.azs[count.index]}" }
}

resource "aws_subnet" "private" {
  count = length(var.private_subnet_cidrs)

  vpc_id            = aws_vpc.this.id
  cidr_block        = var.private_subnet_cidrs[count.index]
  availability_zone = local.azs[count.index]

  tags = { Name = "${local.name}-private-${local.azs[count.index]}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = { Name = "${local.name}-public" }
}

# No routes beyond the VPC's own: this is what "no NAT gateway" looks like in the route table.
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.this.id

  tags = { Name = "${local.name}-private" }
}

resource "aws_route_table_association" "public" {
  count = length(aws_subnet.public)

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count = length(aws_subnet.private)

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}
