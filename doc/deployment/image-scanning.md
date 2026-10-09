# Image scanning

Amazon Inspector scans the backend image ECS runs, and a workflow every six hours turns what it finds into
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
                                  ▼  every 6 h, image-findings.yml
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

`.github/workflows/image-findings.yml` runs every six hours on `main`, as the read-only role
`taskfest-image-findings`, which may call `inspector2:ListFindings` and nothing else. It asks for
findings that are:

- **HIGH or CRITICAL**,
- **fixable**: a version with the fix exists,
- in an image **ECS used in the last 30 days**: by Inspector's in-use record, *or* because the
  image arrived in ECR in that time and **still carries a tag** — through the cache, arriving is
  when ECS first pulled it. The second is what reports a new deployment straight away; see the
  delays below. An untagged digest is one a tag has moved away from, superseded by a newer
  `latest` or release, so it drops out as soon as the fix is pulled — unless Inspector sees ECS
  still running it. **Since the images are multi-architecture (#249)** the cache keeps a release's
  tag on its index, and the image ECS runs — the one Inspector scans — is stored untagged inside
  it. Both environments run on Graviton (#250), so that is the arm64 image; should they ever
  run different architectures, a release is two such images, each scanned on its own. The cache
  keeps fifteen images, enough for about five releases either way. So the workflow reads the cached indexes (`ecr:DescribeImages`, `ecr:BatchGetImage` on
  `quay/*`, granted to the findings role) and counts an image inside a tagged index as carrying
  that tag, and lists it under it; an image no tagged index holds any longer is superseded as
  before.

The filter is narrow because the backend's base image carries many findings without a fix. When
this was set up, 32 of the 36 HIGH findings for `taskfest-backend:0.3.0` were in Red Hat packages
with no fixed version yet, and only Jackson's were actionable. An issue about the other 32 would
teach everyone to ignore it. All findings, including the unfixable ones, are in the Inspector
console under *Findings → By container image*.

`image-findings-issue.py` keeps **one** issue: it opens it, rewrites its table on every run, comments
only when a finding appears that was not listed before — so a notification means something new
— and closes it when none are left.

## Handling the issue

A finding is a question for a person, not a task the pipeline can finish by itself: whether the
vulnerable code is even reachable, whether a fix can wait for the regular update, whether the
risk is acceptable. So the issue is triaged like any other:

1. **Give it a priority** — label and project field, like every issue. Fixable HIGH findings in
   the running image are normally `priority: 1 now`.
2. **Look at each finding.** The usual outcome is that the fix arrives as a dependency or base
   image update through Renovate (Jackson, for example, comes with the Quarkus platform), and is
   then released and deployed. If it cannot wait for that, pull the update forward.
3. **Close it, with the reason that is true**, and a comment saying why:
   - **Close as completed** once the findings are *fixed*. That acknowledges nothing: if one
     comes back — a rollback, a downgrade — it is reported again. Usually unnecessary, because
     the workflow closes the issue as completed by itself once no listed finding is left.
   - **Close as not planned** to *accept* the findings — not exploitable in this service, or a
     fix deliberately deferred. Every finding the issue lists is then acknowledged and never
     listed again, in this issue or a later one; acknowledgements from all such issues add up.
     A finding that was not on the list still opens a new issue, with just that finding.

New findings issues get `priority: 1 now` from the workflow itself. The project entry comes from
the project's *Auto-add* workflow, since the findings workflow's token cannot write to a user
project. If an open issue is left with nothing but findings accepted elsewhere, the workflow
closes it as *not planned*, not as completed — they are accepted, not fixed.

To withdraw an acceptance, reopen the issue that listed the finding. While an issue is open, the
workflow keeps its table current; if you close it during a run, the run leaves it alone and the
next one decides afresh.

**What the mechanism does not do,** deliberately, because closing by hand is the triage:

- **"Not planned" accepts everything the issue lists**, including findings a run added just
  before you closed it — read the "New since the last report" comments first.
- **An acceptance is per CVE and package**, whatever the version, the image or a later re-rating.
  A finding you accepted as HIGH stays accepted if it is re-rated CRITICAL; reopen the issue if
  that matters.
- **Reopening withdraws an acceptance only while no other findings issue is open**, and only if no
  other not-planned issue lists the same finding: the workflow maintains the newest open issue,
  and accepted keys add up across issues.
- **A close that lands in the second between the workflow's check and its edit** can still put a
  just-appeared finding into a not-planned issue. The check narrows that window; it cannot close it.

## Two delays worth knowing

- **Right after Inspector is switched on, it takes hours before it scans anything.** On
  2026-10-05 it noticed every new image within a second (`DescribeImages` in CloudTrail), yet
  listed none in its coverage until the next morning — through the pull-through cache and for an
  image pushed directly alike. Nothing was misconfigured; it was still initialising. Later
  images are scanned within minutes.
- **"In use" is not live.** Inspector learns which images ECS runs on a periodic refresh, not
  when a task starts. On 2026-10-06 qa ran the image for hours without Inspector recording it.
  That is why the workflow counts the image's arrival in ECR as well as the in-use date, since
  the arrival is known immediately: a deployment's findings reach the issue on the next run,
  whether or not Inspector has caught up. The price is that an image pulled but barely run — a
  rolled-back deploy, a debugging pull, the digest `latest` has just moved away from — also
  stays in scope for 30 days, and so may keep the issue open after a fix has shipped until it
  ages out or the cache's lifecycle rule (newest five) expires it.

## Cost

$0.09 for each image's first scan, $0.01 per rescan, and ECR storage at $0.10 per GB-month for
about 0.2 GB per image, at most five images kept: **well under $1 a month**. The findings API is
free. Inspector's own 15-day free trial covers the first two weeks.

## Where it is decided

The choice of Inspector over a CI scanner or Quay's own scanning is in
[the AWS decisions](../decisions/deployment-and-aws.md).
