# How an environment was torn down

**Nothing is torn down any more.** Until #557 the container architecture's billable resources,
the database, the load balancer and the Fargate service, existed only while an environment's
`running` switch was on, and `env.sh up` and `down` created and destroyed them. They are gone
from the infrastructure, and with them the switch and both commands: the Go backend bills per
request and is always there ([serverless.md](serverless.md)). `env.sh up <env>` applies an
environment's configuration ([infrastructure.md](infrastructure.md#applying)).

The container architecture is the alternative, kept in the tag `pre-serverless`, which is the way
back;
[this page as it was there](https://github.com/guhilling/ai-assisted-todolist/blob/pre-serverless/doc/deployment/teardown.md)
describes the switch, CloudFront's `/api/*` origin that came and went with the load balancer, and
the paused screen.
[decisions/deployment-and-aws.md](../decisions/deployment-and-aws.md#the-container-architecture-is-removed-from-the-infrastructure)
records the removal.