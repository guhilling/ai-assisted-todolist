# Open points

## Deliberately not in this plan

- **High availability.** Single AZ for the database, one task for the backend. Explicitly not a
  requirement.
- **Autoscaling.** Demo traffic does not need it, and a fixed task count makes the cost
  predictable.
- **Multi-region, WAF, private subnets.** Each is a real commercial requirement and none is
  demonstrated by having it here.


## To verify before building

Honest gaps, because a plan that hides them is worse than one that names them:

- **ECS-native blue/green** is used rather than CodeDeploy, and it is confirmed to need two
  target groups on one load balancer. What is not yet confirmed is its bake-time and
  automatic-rollback-on-alarm behaviour.
- **`eu-central-1` pricing** — every figure above is a US East rate.
- ~~**VPC origins require an internet gateway attached to the VPC**~~ — confirmed by AWS's own
  documentation: the internet gateway is required "to denote that the VPC can receive traffic from
  the internet" and is not used for routing to the origin. The load balancer can sit in a subnet
  with no route out.
- ~~**Whether VPC-origin traffic arrives from the CloudFront prefix list**~~ — yes; AWS documents
  the prefix list and the per-VPC-origin security group as the two ways to admit it. `security.tf`
  says why the prefix list.
- **Tag-filtered budgets** report with a delay and ignore untagged resources; confirm the
  per-environment figures are trustworthy before relying on them instead of a per-account bill.
- **Whether a GitHub environment secret is genuinely unreadable** from a workflow run that has
  not passed the approval gate — the prod key's protection rests on it.
