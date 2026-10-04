# How an environment is torn down

**Teardown is a parameter, not a `tofu destroy`.** Each environment has a `running` variable; the
resources that cost money — the database, the load balancer, the service — exist only when it is
true. The foundation ignores it and is always there, because it is free and destroying it buys
nothing.

**The CloudFront distribution stays; its `/api/*` origin does not.** A CloudFront VPC origin names
one load balancer ARN and cannot be changed or deleted while a distribution uses it, and the load
balancer is destroyed on every `down`. So `down` drops the distribution's `/api/*` behaviour and
deletes the VPC origin, and `up` creates a new one and adds the behaviour back. Deploying a VPC
origin takes up to 15 minutes and a distribution change several more, so `up` and `down` each take
**roughly 25–35 minutes**. That is the price of a `down` that costs nothing; keeping the load
balancer up instead would have cost about $20 a month while nobody was using the environment.
While down, the distribution still answers, from the site bucket alone.

```sh
deployment/aws-tofu/env.sh up qa       # create what bills
deployment/aws-tofu/env.sh down qa     # destroy it; VPC, subnets and IAM stay
deployment/aws-tofu/env.sh status qa   # what the last apply recorded
```

Three properties of this are deliberate:

- **`running` defaults to `false`.** An environment nobody is demoing is meant to cost nothing, so
  the safe outcome of an apply nobody thought hard about is a foundation and no bill. Bringing an
  environment up is the deliberate act; leaving it up is not.
- **It is never set in `terraform.tfvars`.** Whether an environment happens to be up is a
  transient fact about the world. Committing it would make every teardown a commit and every
  `git pull` a possible surprise — so it is passed on the command line, which is what `env.sh`
  is for.
- **Every billable resource is guarded, and that is checked.** `check-billable-guard.py` fails the
  build on a resource in `billable.tf` without `count = var.running ? 1 : 0`. The failure mode it
  prevents is silent: teardown succeeds, the resource keeps running, and the bill a month later is
  the first evidence.

The alternative was a separate root and state for the billable layer, where `tofu destroy` could
not reach the foundation. It was rejected: the environment roots are already applied, so their
state keys would have had to move, and a parameter is the same mechanism this directory already
uses for the difference between qa and prod.

`env.sh` shows the plan and waits for an answer on every run, and applies the saved plan file
rather than re-evaluating — so what is applied is exactly what was displayed. It defaults to the
lifecycle profile for `up` and `down`, and deliberately not for `status`, since reading what the
last apply recorded needs nothing but the state bucket.

