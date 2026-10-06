#!/usr/bin/env python3
"""
Deploys one backend release to one environment, blue/green, by version and digest (#181).

Run by deploy-backend.yml as the environment's deploy role:

    python3 .github/scripts/deploy-backend.py --environment qa --version v0.5.0

What it does, in order:

1. Resolves the release's image digest on Quay, so what is deployed is exactly what was released.
   The task pulls it through this account's ECR cache by version *and* digest: a tag the cache
   has served before can come back stale (#181), a digest cannot.
2. Skips, without failing, an environment that is down -- there is nothing to deploy to, and the
   next `env.sh up` starts the newest release anyway.
3. Stops, failing, if the release changes the database changelog compared with the version that
   is running. Blue/green keeps both versions live, which is exactly the overlap a schema change
   must not have; that release needs the downtime path in doc/deployment/deploying.md. The
   running version is read from its image tag; if it is `latest`, the previous release counts.
4. Registers a task definition that differs from the running one in the image only, points the
   service at it, and waits until ECS reports the service stable -- bake included -- or fails.

Needs AWS credentials and AWS_REGION, git history with tags, and GITHUB_STEP_SUMMARY (optional).
"""

import argparse
import copy
import dataclasses
import json
import os
import re
import subprocess
import sys
import urllib.request

PROJECT = "taskfest"
QUAY_REPOSITORY = "ghilling/taskfest-backend"
CHANGELOG_DIR = "backend/src/main/resources/db"
# Fields DescribeTaskDefinition returns that RegisterTaskDefinition refuses or sets itself.
READ_ONLY_FIELDS = ("taskDefinitionArn", "revision", "status", "registeredAt", "registeredBy",
                    "deregisteredAt", "compatibilities", "requiresAttributes")
TAG = re.compile(r":(\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+)?)(?:@sha256:[0-9a-f]{64})?$")


@dataclasses.dataclass
class Action:
    """What to do with this environment: deploy, skip (it is down) or stop (needs downtime)."""
    kind: str
    reason: str = ""


def image_reference(account, region, version, digest):
    """The release's image as ECS pulls it: through the quay.io cache, by version and digest."""
    tag = version.removeprefix("v")
    return f"{account}.dkr.ecr.{region}.amazonaws.com/quay/{QUAY_REPOSITORY}:{tag}@{digest}"


def version_of(image):
    """The release tag (v1.2.3) an image reference names, or None for latest or anything else."""
    match = TAG.search(image)
    return f"v{match.group(1)}" if match else None


def next_task_definition(running, image):
    """The registration input for a new revision: the running one with only the image changed."""
    new = copy.deepcopy(running)
    for field in READ_ONLY_FIELDS:
        new.pop(field, None)
    new["containerDefinitions"][0]["image"] = image
    return new


def decide(service_active, migrations_differ):
    """The whole policy, as a pure function of the environment's state and the changelog diff."""
    if not service_active:
        return Action("skip", "the backend service is not running here -- the environment is down")
    if migrations_differ:
        return Action("stop", "this release changes the database migrations, which blue/green must "
                              "not roll out under live traffic; use the downtime path "
                              "(doc/deployment/deploying.md)")
    return Action("deploy")


def aws(*args):
    output = subprocess.run(["aws", *args, "--output", "json"], check=True,
                            capture_output=True, text=True).stdout
    return json.loads(output) if output.strip() else {}


def release_digest(version):
    url = (f"https://quay.io/api/v1/repository/{QUAY_REPOSITORY}/tag/"
           f"?specificTag={version.removeprefix('v')}&onlyActiveTags=true")
    with urllib.request.urlopen(url, timeout=30) as response:
        tags = json.load(response)["tags"]
    if not tags:
        raise SystemExit(f"::error::{QUAY_REPOSITORY}:{version.removeprefix('v')} is not on Quay")
    return tags[0]["manifest_digest"]


def previous_release(version):
    return subprocess.run(["git", "describe", "--tags", "--abbrev=0", "--match", "v*", f"{version}^"],
                          check=True, capture_output=True, text=True).stdout.strip()


def changelog_differs(running, version):
    if running == version:
        return False
    diff = subprocess.run(["git", "diff", "--quiet", running, version, "--", CHANGELOG_DIR])
    return diff.returncode != 0


def summary(text):
    print(text)
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as out:
            out.write(text + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", required=True)
    parser.add_argument("--version", required=True)
    args = parser.parse_args()

    region = os.environ["AWS_REGION"]
    cluster, service = f"{PROJECT}-{args.environment}", f"{PROJECT}-{args.environment}-backend"
    account = aws("sts", "get-caller-identity")["Account"]

    services = aws("ecs", "describe-services", "--cluster", cluster, "--services", service)
    active = [s for s in services.get("services", []) if s.get("status") == "ACTIVE"]
    running_image = None
    running = None
    if active:
        running = aws("ecs", "describe-task-definition", "--task-definition",
                      active[0]["taskDefinition"])["taskDefinition"]
        running_image = running["containerDefinitions"][0]["image"]
    running_version = (version_of(running_image) if running_image else None) or previous_release(args.version)

    action = decide(bool(active), active and changelog_differs(running_version, args.version))
    if action.kind == "skip":
        summary(f"**{args.version} not deployed to {args.environment}:** {action.reason}.")
        return 0
    if action.kind == "stop":
        summary(f"::error::{args.version} not deployed to {args.environment}: {action.reason}. "
                f"Changelog compared with {running_version}.")
        return 1

    image = image_reference(account, region, args.version, release_digest(args.version))
    registered = aws("ecs", "register-task-definition", "--cli-input-json",
                     json.dumps(next_task_definition(running, image)))["taskDefinition"]
    aws("ecs", "update-service", "--cluster", cluster, "--service", service,
        "--task-definition", registered["taskDefinitionArn"])
    print(f"Rolling out {registered['taskDefinitionArn']} -- waiting for the service to settle")
    subprocess.run(["aws", "ecs", "wait", "services-stable", "--cluster", cluster, "--services", service],
                   check=True)
    summary(f"**{args.version} deployed to {args.environment}** (was {running_version}), "
            f"`{image}`, task definition revision {registered['revision']}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
