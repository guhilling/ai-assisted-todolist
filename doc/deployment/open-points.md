# Open points

The container architecture's open points, on ECS blue/green and CloudFront's VPC origins, went
with it (#557).

## Deliberately not in this plan

- **High availability.** Explicitly not a requirement. The Go backend is regional, as Lambda and
  DynamoDB are, without anything being built for it.
- **Multi-region, WAF, private subnets.** Each is a real commercial requirement and none is
  demonstrated by having it here.


## To verify before building

Honest gaps, because a plan that hides them is worse than one that names them:

- **`eu-central-1` pricing** — every figure above is a US East rate.
- **Tag-filtered budgets** report with a delay and ignore untagged resources; confirm the
  per-environment figures are trustworthy before relying on them instead of a per-account bill.
- **Whether a GitHub environment secret is genuinely unreadable** from a workflow run that has
  not passed the approval gate — the prod key's protection rests on it.
