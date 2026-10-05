# Image scanning

Amazon Inspector scans the backend image ECS runs, and a daily workflow turns what it finds into
a GitHub issue (#162). Nobody has to look at a console; an issue appears when there is something
to do, and closes itself once there is not.

## The path of an image

```
GitHub Actions ──push──> quay.io/ghilling/taskfest-backend
                                  │
                                  │  first pull of a tag
                                  ▼
ECS task ──pull──> ECR  <account>.dkr.ecr.eu-central-1.amazonaws.com/quay/ghilling/taskfest-backend
                    │
                    └── Amazon Inspector: scans on arrival, rescans whenever a CVE is published
                                  │
                                  ▼  daily, image-findings.yml
                        GitHub issue, label `image-vulnerability`
```

- **Publishing does not change.** Images are still built in CI and pushed to Quay.
- **ECR's pull-through cache** (`account/image-scanning.tf`) fetches an image from Quay the first
  time a task pulls it, into a repository under `quay/` that it creates itself, and serves it
  from ECR afterwards. The task execution role may pull through it, for this project's images
  only (`modules/environment/ecs.tf`).
- **Inspector scans continuously.** The repositories under `quay/` have enhanced, continuous
  scanning: once on arrival, and again whenever a new CVE affects something in the image. It also
  records which images ECS has used and when.
- **Only the newest five images are kept** per repository, by the creation template's lifecycle
  rule. That holds storage down, and stops paying for rescans of images nobody runs any more.

## What reaches the issue

`.github/workflows/image-findings.yml` runs daily on `main`, as the read-only role
`taskfest-image-findings`, which may call `inspector2:ListFindings` and nothing else. It asks for
findings that are:

- **HIGH or CRITICAL**,
- **fixable**: a version with the fix exists,
- in an image **ECS ran in the last 30 days**, so qa being down for a week loses nothing.

The filter is narrow because the backend's base image carries many findings without a fix. When
this was set up, 32 of the 36 HIGH findings for `taskfest-backend:0.3.0` were in Red Hat packages
with no fixed version yet, and only Jackson's were actionable. An issue about the other 32 would
teach everyone to ignore it. All findings, including the unfixable ones, are in the Inspector
console under *Findings → By container image*.

`image-findings-issue.py` keeps **one** issue: it opens it, rewrites its table daily, comments
only when a finding appears that was not listed before — so a notification means something new
— and closes it when none are left. The usual fix is a dependency or base-image update through
Renovate, then a release.

## Cost

$0.09 for each image's first scan, $0.01 per rescan, and ECR storage at $0.10 per GB-month for
about 0.2 GB per image, at most five images kept: **well under $1 a month**. The findings API is
free. Inspector's own 15-day free trial covers the first two weeks.

## Where it is decided

The choice of Inspector over a CI scanner or Quay's own scanning is in
[the AWS decisions](../decisions/deployment-and-aws.md).
