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
3. Compares the release's database changelog with the version that is running. The running
   version is read from its image tag; if it is `latest`, the previous release counts.
4. Without a migration, blue/green: registers a task definition that differs in the image only
   from the configuration last applied -- the newest active revision this deploy role did not
   register, usually tofu's (#189) -- points the service at it, and waits until that deployment's
   rollout completes -- bake included -- or fails. Redeploying the running version keeps its exact
   image, which is how a configuration change is rolled out without a release.
5. With a migration, the downtime path (#215), because blue/green keeps both versions live, which
   is exactly the overlap a schema change must not have: scales the service to zero, takes a
   manual snapshot of the database, runs the migrate task on the release's image, and starts the
   release as in 4. A failure before the migration restarts the old version, whose schema is
   untouched; one from the migration on leaves the service at zero and names the snapshot to
   restore (doc/deployment/database.md). The newest three pre-release snapshots are kept.

With --preview it deploys nothing and needs no AWS: it says whether the release changes the
changelog compared with the previous release, for the job name the prod approval shows.

With --print-image it deploys nothing and prints the image `env.sh up` starts the backend as:
what the environment runs if it is up, otherwise the release given (startup_choice).

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
import time
import urllib.request

PROJECT = "taskfest"
QUAY_REPOSITORY = "ghilling/taskfest-backend"
CHANGELOG_DIR = "backend/src/main/resources/db"
# Fields DescribeTaskDefinition returns that RegisterTaskDefinition refuses or sets itself.
READ_ONLY_FIELDS = ("taskDefinitionArn", "revision", "status", "registeredAt", "registeredBy",
                    "deregisteredAt", "compatibilities", "requiresAttributes")
# How long a rollout may take, bake included: prod bakes five minutes, and the traffic shifts and
# health checks around it take a few more. `aws ecs wait services-stable` gives up after ten.
ROLLOUT_TIMEOUT_SECONDS = 30 * 60
# The downtime path's other waits. Draining is the deregistration delay plus a stop; a snapshot
# of a demo database takes minutes, and pulling the image is most of a migration.
DRAIN_TIMEOUT_SECONDS = 10 * 60
SNAPSHOT_TIMEOUT_SECONDS = 45 * 60
MIGRATE_TIMEOUT_SECONDS = 20 * 60
# D3 on #215: snapshots taken before a migration, kept per environment.
SNAPSHOTS_KEPT = 3
# In order. What a failure at each leaves behind is after_failure's.
DOWNTIME_STEPS = ("stop", "snapshot", "migrate", "start")
TAG = re.compile(r":(\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+)?)(?:@sha256:[0-9a-f]{64})?$")


@dataclasses.dataclass
class Action:
    """What to do with this environment: deploy (blue/green), downtime (it migrates) or skip (it is down)."""
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


def next_task_definition(base, image):
    """The registration input for a new revision: `base` -- the configuration to carry -- with only
    the image changed."""
    new = copy.deepcopy(base)
    for field in READ_ONLY_FIELDS:
        new.pop(field, None)
    new["containerDefinitions"][0]["image"] = image
    return new


def applied_revision(describe, running, deploy_role, limit=100):
    """The revision whose configuration a deploy carries: the one last applied (#189).

    The service ignores task_definition in tofu, so an apply that changes the backend's
    configuration -- a variable, a secret, CPU -- registers a revision the service does not run,
    and copying the *running* revision would throw that change away with the next deploy. So the
    configuration comes from the newest active revision this environment's deploy role did not
    register: whatever tofu, or a person, applied last. A deploy's own revisions are copies and say
    nothing new, and going by `registeredBy` rather than by the highest number means an apply that
    lands while a deploy is under way is still found afterwards, not buried under the deploy's copy.

    Falls back to the running revision when no applied one is active, or the family cannot be read.

    describe: returns a task definition for a family or `family:revision`, raising if it cannot.
    """
    family = running["family"]
    try:
        newest = describe(family)
    except Exception:  # noqa: BLE001 -- any failure to read the family means: keep what runs
        return running
    for number in range(newest["revision"], max(newest["revision"] - limit, 0), -1):
        try:
            candidate = newest if number == newest["revision"] else describe(f"{family}:{number}")
        except Exception:  # noqa: BLE001 -- a revision deleted for good is simply not a candidate
            continue
        if candidate.get("status") == "ACTIVE" and not registered_by_role(candidate, deploy_role):
            return candidate
    return running


def registered_by_role(task_definition, role):
    """Whether a revision was registered by a session of this IAM role."""
    return f":assumed-role/{role}/" in task_definition.get("registeredBy", "")


def image_to_deploy(running_image, version, resolve):
    """The image to deploy: the running one, exactly, when redeploying its version; else resolved.

    Redeploying the running version is how a configuration change is rolled out (#189), and it
    must change nothing but the configuration -- not even a digest a re-pushed tag would move.
    """
    if running_image and version_of(running_image) == version:
        return running_image
    return resolve()


def decide(service_active, migrations_differ):
    """The whole policy, as a pure function of the environment's state and the changelog diff."""
    if not service_active:
        return Action("skip", "the backend service is not running here -- the environment is down")
    if migrations_differ:
        return Action("downtime", "this release changes the database migrations, which blue/green must "
                                  "not roll out under live traffic")
    return Action("deploy")


def after_failure(step):
    """What a failed downtime step leaves running: "restart" the old version, or "stay-down".

    Until `migrate` runs the schema is the old version's, so it can simply come back. From then on
    neither version is safe -- the old one against a migrated schema, either against a half-migrated
    one -- so the service stays at zero until a person has looked.
    """
    return "restart" if DOWNTIME_STEPS.index(step) < DOWNTIME_STEPS.index("migrate") else "stay-down"


def database_instance(environment):
    return f"{PROJECT}-{environment}-db"


def snapshot_prefix(environment):
    """What every pre-release snapshot's name starts with -- and a final snapshot's (`-final-`) never does."""
    return f"{database_instance(environment)}-pre-release-"


def snapshot_identifier(environment, version, stamp):
    """The manual snapshot taken before migrating: environment, release and time, in the letters,
    digits and single hyphens RDS allows."""
    release = re.sub(r"[^0-9A-Za-z]+", "-", version).strip("-")
    return f"{snapshot_prefix(environment)}{release}-{stamp}"


def snapshots_to_delete(snapshots, environment, keep=SNAPSHOTS_KEPT):
    """The pre-release snapshots beyond the newest `keep`, newest first (D3 on #215).

    Only this environment's pre-release snapshots are counted or deleted: a final snapshot is what
    `env.sh up` restores, and one still being created is not yet a way back.
    """
    ours = [snapshot for snapshot in snapshots
            if snapshot["DBSnapshotIdentifier"].startswith(snapshot_prefix(environment))
            and snapshot.get("Status") == "available"]
    ours.sort(key=lambda snapshot: snapshot["SnapshotCreateTime"], reverse=True)
    return [snapshot["DBSnapshotIdentifier"] for snapshot in ours[keep:]]


def task_network(service):
    """The migrate task's network: the service's own, so it reaches the database the way the backend does."""
    return {"awsvpcConfiguration": service["networkConfiguration"]["awsvpcConfiguration"]}


def task_outcome(task):
    """(succeeded, why) for a stopped one-off task. No exit code means the container never ran --
    an image pull or a secret -- and then the stopped reason is the only explanation there is."""
    exit_code = task["containers"][0].get("exitCode")
    if exit_code is None:
        return False, f"it never ran: {task.get('stoppedReason', 'no reason given')}"
    return exit_code == 0, f"exit code {exit_code}"


def rollout_state(services, task_definition_arn):
    """The rolloutState of this task definition's deployment, or MISSING when none is listed."""
    for service in services.get("services", []):
        for deployment in service.get("deployments", []):
            if deployment.get("taskDefinition") == task_definition_arn:
                return deployment.get("rolloutState", "IN_PROGRESS")
    return "MISSING"


def next_state(state, seen):
    """What a polled state means. A deployment not listed yet is waited for -- describe-services
    is eventually consistent -- but one that vanished after it was seen was rolled back: ECS
    replaces it with one for the previous task definition."""
    if state == "MISSING":
        return "FAILED" if seen else "IN_PROGRESS"
    return state


def startup_choice(service_active, running_image, version):
    """What `env.sh up` starts the backend as: ("keep", image), ("release", version) or ("error", why).

    An environment that is already up keeps what it runs. Releases reach it through this script,
    past the migration check; if `up` moved the task definitions tofu owns -- `migrate` among
    them -- to a newer release, a release that check stopped could reach the database anyway.
    """
    if service_active:
        return ("keep", running_image)
    if not version:
        return ("error", "name the release to start, e.g. ./env.sh up prod v1.2.3")
    return ("release", version)


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


def print_startup_image(args, region, account, active, running_image):
    """env.sh up's half: print the image to start, or explain on stderr and fail."""
    kind, value = startup_choice(bool(active), running_image, args.version)
    if kind == "error":
        print(f"{args.environment} is down, so there is nothing to keep: {value}", file=sys.stderr)
        return 1
    if kind == "keep":
        if args.version:
            print(f"{args.environment} is up, so it keeps what it runs; {args.version} is deployed "
                  f"with deploy-backend.yml, not with up.", file=sys.stderr)
        print(value)
        return 0
    print(image_reference(account, region, value, release_digest(value)))
    return 0


def register_release(base, image):
    """Registers `base` with only the image changed, and returns the new revision."""
    return aws("ecs", "register-task-definition", "--cli-input-json",
               json.dumps(next_task_definition(base, image)))["taskDefinition"]


def wait_for_rollout(cluster, service, task_definition_arn):
    """Polls until this task definition's deployment completes, fails or the timeout passes."""
    deadline = time.monotonic() + ROLLOUT_TIMEOUT_SECONDS
    state, seen = "IN_PROGRESS", False
    while state == "IN_PROGRESS" and time.monotonic() < deadline:
        time.sleep(15)
        try:
            polled = rollout_state(aws("ecs", "describe-services", "--cluster", cluster, "--services", service),
                                   task_definition_arn)
        except subprocess.CalledProcessError as error:
            # Throttling or a network blip; the rollout goes on regardless, so keep watching it.
            print(f"  describe-services failed, retrying: {error.stderr.strip()}")
            continue
        seen = seen or polled != "MISSING"
        state = next_state(polled, seen)
        print(f"  {polled}")
    return state


def wait_until(what, timeout, done):
    """Polls `done` every 15 seconds; raises if it is not true within `timeout` seconds."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if done():
            return
        time.sleep(15)
    raise RuntimeError(f"{what} did not happen within {timeout // 60} minutes")


class Downtime:
    """The downtime path's AWS calls, one method per step of DOWNTIME_STEPS (#215)."""

    def __init__(self, environment, cluster, service, describe_service, deploy_role):
        self.environment, self.cluster, self.service = environment, cluster, service
        self.describe_service, self.deploy_role = describe_service, deploy_role
        self.snapshot = None
        self.migrate_task = None

    def scale(self, count):
        aws("ecs", "update-service", "--cluster", self.cluster, "--service", self.service,
            "--desired-count", str(count))

    def stop(self):
        self.scale(0)
        print("Scaled the backend to zero; waiting until no task runs.")

        def stopped():
            service = self.describe_service()
            return service["runningCount"] == 0 and service["pendingCount"] == 0

        wait_until("the backend stopping", DRAIN_TIMEOUT_SECONDS, stopped)
        return "no task runs"

    def snapshot_database(self, version):
        self.snapshot = snapshot_identifier(self.environment, version, time.strftime("%Y%m%d-%H%M%S", time.gmtime()))
        aws("rds", "create-db-snapshot", "--db-instance-identifier", database_instance(self.environment),
            "--db-snapshot-identifier", self.snapshot)
        print(f"Taking snapshot {self.snapshot}; waiting until it is available.")
        wait_until("the snapshot becoming available", SNAPSHOT_TIMEOUT_SECONDS, lambda: aws(
            "rds", "describe-db-snapshots", "--db-snapshot-identifier", self.snapshot,
        )["DBSnapshots"][0]["Status"] == "available")
        return f"`{self.snapshot}`"

    def migrate(self, image):
        family = f"{PROJECT}-{self.environment}-migrate"
        describe = lambda name: aws("ecs", "describe-task-definition", "--task-definition", name)["taskDefinition"]
        newest = describe(family)
        registered = register_release(applied_revision(describe, newest, self.deploy_role), image)
        self.migrate_task = aws(
            "ecs", "run-task", "--cluster", self.cluster, "--task-definition", registered["taskDefinitionArn"],
            "--launch-type", "FARGATE", "--started-by", "deploy-backend",
            "--network-configuration", json.dumps(task_network(self.describe_service())),
        )["tasks"][0]["taskArn"]
        print(f"Migrating with task {self.migrate_task}; waiting for it to finish.")
        stopped = {}

        def finished():
            task = aws("ecs", "describe-tasks", "--cluster", self.cluster, "--tasks", self.migrate_task)["tasks"][0]
            stopped.update(task)
            return task.get("lastStatus") == "STOPPED"

        wait_until("the migration finishing", MIGRATE_TIMEOUT_SECONDS, finished)
        succeeded, why = task_outcome(stopped)
        log = f"log stream `task/migrate/{self.migrate_task.rsplit('/', 1)[-1]}` in `/ecs/{PROJECT}-{self.environment}`"
        if not succeeded:
            raise RuntimeError(f"the migration failed, {why}; see its {log}")
        return f"{why}, revision {registered['revision']}; {log}"

    def start(self, base, image, count):
        registered = register_release(base, image)
        aws("ecs", "update-service", "--cluster", self.cluster, "--service", self.service,
            "--task-definition", registered["taskDefinitionArn"], "--desired-count", str(count))
        print(f"Starting {registered['taskDefinitionArn']} with {count} task(s); waiting until it is serving.")
        state = wait_for_rollout(self.cluster, self.service, registered["taskDefinitionArn"])
        if state != "COMPLETED":
            raise RuntimeError(f"the rollout {'did not finish in time' if state == 'IN_PROGRESS' else state}")
        return f"{count} task(s) serving, revision {registered['revision']}"

    def prune_snapshots(self):
        """Deletes pre-release snapshots beyond the newest three; a failure only warns."""
        try:
            snapshots = aws("rds", "describe-db-snapshots", "--db-instance-identifier",
                            database_instance(self.environment), "--snapshot-type", "manual")["DBSnapshots"]
            for name in snapshots_to_delete(snapshots, self.environment):
                aws("rds", "delete-db-snapshot", "--db-snapshot-identifier", name)
                print(f"Deleted the old pre-release snapshot {name}.")
        except subprocess.CalledProcessError as error:
            print(f"::warning::Old pre-release snapshots were not cleaned up: {error.stderr.strip()}")


def take_downtime(args, cluster, service, running_version, running_count, base, image):
    """Runs the downtime path step by step, recovers as after_failure says, and reports each step."""
    describe_service = lambda: aws("ecs", "describe-services", "--cluster", cluster,
                                   "--services", service)["services"][0]
    path = Downtime(args.environment, cluster, service, describe_service, f"{PROJECT}-{args.environment}-deploy")
    # The environment is up, so it is meant to serve: a service found at zero starts with one task.
    count = max(running_count, 1)
    run = {
        "stop": path.stop,
        "snapshot": lambda: path.snapshot_database(args.version),
        "migrate": lambda: path.migrate(image),
        "start": lambda: path.start(base, image, count),
    }
    lines = [f"**{args.version} to {args.environment}, with downtime:** the release changes the database "
             f"migrations (compared with {running_version}).", "", "| Step | Outcome |", "| --- | --- |"]
    for step in DOWNTIME_STEPS:
        try:
            outcome = run[step]()
        except (RuntimeError, subprocess.CalledProcessError, KeyError, IndexError) as error:
            why = error.stderr.strip() if isinstance(error, subprocess.CalledProcessError) else str(error)
            lines.append(f"| {step} | **failed:** {why} |")
            lines += ["", recover(path, step, running_version, running_count)]
            summary("\n".join(lines))
            return 1
        lines.append(f"| {step} | {outcome} |")
        if step == "snapshot":
            path.prune_snapshots()
    lines += ["", f"**{args.version} deployed to {args.environment}** (was {running_version}), `{image}`."]
    summary("\n".join(lines))
    return 0


def recover(path, step, running_version, running_count):
    """Leaves the environment as after_failure says, and says what a person does next."""
    if after_failure(step) == "restart":
        try:
            path.scale(running_count)
        except subprocess.CalledProcessError as error:
            return (f"::error::Nothing was migrated, but restarting {running_version} failed too: "
                    f"{error.stderr.strip()}. Scale the service back to {running_count} by hand.")
        return (f"::error::Nothing was migrated, so {running_version} is starting again with "
                f"{running_count} task(s).")
    try:
        path.scale(0)
    except subprocess.CalledProcessError as error:
        print(f"::warning::Could not scale the service to zero: {error.stderr.strip()}")
    restore = (f"Restore snapshot `{path.snapshot}` as described in doc/deployment/database.md, "
               f"or fix the cause and deploy again." if path.snapshot else "")
    return (f"::error::The service is left at zero: neither {running_version} nor the release may run "
            f"against this schema until a person has looked. {restore}")


def preview(version):
    """--preview: whether the release migrates, compared with the previous release, for the approval."""
    previous = previous_release(version)
    downtime = changelog_differs(previous, version)
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as out:
            out.write(f"downtime={'true' if downtime else 'false'}\n")
    summary(f"**{version} changes the database migrations** compared with {previous}: deploying it means "
            f"a few minutes' downtime -- stop, snapshot, migrate, start." if downtime else
            f"{version} changes no database migration compared with {previous}: blue/green, no downtime. "
            f"The deploy itself compares with the version actually running.")
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", required=True)
    parser.add_argument("--version")
    parser.add_argument("--print-image", action="store_true",
                        help="print the image `env.sh up` starts the backend as, and deploy nothing")
    parser.add_argument("--preview", action="store_true",
                        help="say whether the release migrates, compared with the previous release; no AWS")
    args = parser.parse_args()
    if not args.print_image and not args.version:
        parser.error("--version is required to deploy")
    if args.preview:
        return preview(args.version)

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
    if args.print_image:
        return print_startup_image(args, region, account, active, running_image)
    running_version = (version_of(running_image) if running_image else None) or previous_release(args.version)

    action = decide(bool(active), active and changelog_differs(running_version, args.version))
    if action.kind == "skip":
        summary(f"**{args.version} not deployed to {args.environment}:** {action.reason}.")
        return 0

    image = image_to_deploy(running_image, args.version,
                            lambda: image_reference(account, region, args.version, release_digest(args.version)))
    base = applied_revision(
        lambda name: aws("ecs", "describe-task-definition", "--task-definition", name)["taskDefinition"],
        running, f"{PROJECT}-{args.environment}-deploy")
    if action.kind == "downtime":
        return take_downtime(args, cluster, service, running_version, active[0]["desiredCount"], base, image)

    carried = (f" Configuration from revision {base['revision']}, applied since revision "
               f"{running['revision']} was deployed." if base["revision"] > running["revision"] else "")
    registered = register_release(base, image)
    aws("ecs", "update-service", "--cluster", cluster, "--service", service,
        "--task-definition", registered["taskDefinitionArn"])
    print(f"Rolling out {registered['taskDefinitionArn']} -- waiting for it to complete, bake included")
    state = wait_for_rollout(cluster, service, registered["taskDefinitionArn"])
    if state == "IN_PROGRESS":
        summary(f"::error::{args.version} to {args.environment}: the rollout is still in progress after "
                f"30 minutes and may yet complete -- check the service before deploying anything else.")
        return 1
    if state != "COMPLETED":
        summary(f"::error::{args.version} not deployed to {args.environment}: the rollout {state}, "
                f"and ECS restores {running_version}.")
        return 1
    summary(f"**{args.version} deployed to {args.environment}** (was {running_version}), "
            f"`{image}`, task definition revision {registered['revision']}.{carried}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
