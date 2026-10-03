variable "project" {
  description = "Name prefix for every resource, so one account can hold more than this."
  type        = string
  default     = "todolist"
}

variable "environment" {
  description = "Which environment this is. Everything is tagged with it, and the budgets filter on that tag."
  type        = string

  validation {
    condition     = contains(["qa", "prod"], var.environment)
    error_message = "environment must be qa or prod: the tag drives cost attribution and the IAM policies."
  }
}

variable "vpc_cidr" {
  description = "Address space for the environment's VPC. The two environments must not overlap if they are ever peered."
  type        = string
}

variable "public_subnet_cidrs" {
  description = <<-EOT
    Subnets for the ECS tasks, which take a public IP so they can reach the image registry and
    the identity provider without a NAT gateway. Two, because the load balancer requires two
    availability zones -- that is the reason, not availability.
  EOT
  type        = list(string)

  validation {
    condition     = length(var.public_subnet_cidrs) == 2
    error_message = "exactly two public subnets: the load balancer requires two availability zones."
  }
}

variable "private_subnet_cidrs" {
  description = <<-EOT
    Subnets for the internal load balancer. Nothing in them makes outbound calls, so they need
    no NAT gateway -- which is what keeps the largest avoidable line item off the bill.
  EOT
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_cidrs) == 2
    error_message = "exactly two private subnets: the load balancer requires two availability zones."
  }
}

variable "backend_port" {
  description = "The port the Quarkus container listens on."
  type        = number
  default     = 8080
}

variable "github_oidc_repository" {
  description = <<-EOT
    The repository whose workflows may assume this environment's deploy role, exactly as GitHub
    writes it into the OIDC token's `sub` claim after `repo:`. Part of the trust condition, so a
    token from any other repository is refused.

    The repository uses GitHub's *immutable subject*, so this is owner@id/name@id rather than
    owner/name: a repository deleted and recreated under the same name, or a rename, gets new
    ids and is refused, where the plain name could not tell them apart. The value is what
    `gh api repos/<owner>/<repo>/actions/oidc/customization/sub` reports as sub_claim_prefix,
    without the leading `repo:`. A plain owner/name here was why the first deploy could not
    assume the role.

    It has a default because it is a property of the project rather than of an environment --
    keeping it out of the values files, which exist for what actually differs between qa and
    prod.
  EOT
  type        = string
  default     = "guhilling@2537533/ai-assisted-todolist@1383592232"
}

variable "running" {
  description = <<-EOT
    Whether this environment's billable resources exist: the database, the load balancer and the
    running service. The foundation -- VPC, subnets, security groups, IAM -- ignores this and is
    always present, because it is free and nothing is gained by destroying it.

    It defaults to **false** on purpose. An environment that nobody is demoing is meant to cost
    nothing, so the safe outcome of an apply nobody thought hard about is a foundation and no
    bill. Bringing an environment up is the deliberate act, not leaving it up.

    It is deliberately not set in terraform.tfvars. Whether an environment happens to be up right
    now is a transient fact about the world, and committing it would make every teardown a commit
    and every `git pull` a possible surprise. Pass it on the command line -- or use `env.sh`,
    which is the reason that script exists.
  EOT
  type        = bool
  default     = false
}

variable "state_bucket" {
  description = <<-EOT
    The bucket holding OpenTofu state. The lifecycle role needs read and write on this
    environment's key, because an apply reads and writes state before it touches anything else.

    It must match the `bucket` in each root's backend.tf, which cannot reference a variable
    defined here -- a backend block is evaluated before the module exists. The two are kept in
    step by hand, and a mismatch shows up immediately as a 403 on the first apply.
  EOT
  type        = string
  default     = "todolist-tofu-state"
}

variable "db_restore_snapshot" {
  description = <<-EOT
    The snapshot a newly created database is restored from, or null for an empty one. Only read
    when the instance is created: on a running database it is ignored, so passing a newer
    snapshot can never replace it.

    `env.sh up` sets it to the newest final snapshot of this environment's database, which is
    what makes a down/up cycle keep the data. Like `running`, it is deliberately not in
    terraform.tfvars -- which snapshot is newest is a fact about the world, not the code.
  EOT
  type        = string
  default     = null
}

variable "log_retention_days" {
  description = "How long the ECS task logs are kept. Shorter in qa than in prod, per doc/deployment.md."
  type        = number
}

variable "backend_image" {
  description = <<-EOT
    The backend image the one-off tasks run. Quay's `latest`, which main publishes, until the
    deploy change pins a release: from then on the deploy role registers a task definition per
    release, and this only seeds the first one. Public, so no registry credentials are needed --
    the tasks pull it over their public IP.
  EOT
  type        = string
  default     = "quay.io/ghilling/todo-backend:latest"
}

variable "hostname" {
  description = <<-EOT
    The environment's public name. CloudFront answers on it, and the load balancer's own
    certificate carries it too: /api/* forwards the viewer's Host header, so CloudFront checks the
    origin certificate against this name rather than the load balancer's AWS-generated one.
  EOT
  type        = string
}

variable "dns_zone" {
  description = "The existing Route 53 zone the hostname lives in. A property of the project, not of an environment."
  type        = string
  default     = "cloud.hilling.de"
}
