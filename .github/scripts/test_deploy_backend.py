"""
Pins down the decisions deploy-backend.py makes, without AWS, Quay or git (#181).

Deploying is: find the release's image by digest, decide whether this environment can take it
blue/green, and register a task definition that differs in the image only from the configuration
last applied -- which is the running one unless an apply has registered a newer one (#189).
Getting any of those wrong deploys the wrong thing, or rolls a schema change out under live
traffic -- the one case blue/green must not handle.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import importlib.util
import pathlib
import unittest

_spec = importlib.util.spec_from_file_location(
    "deploy_backend", pathlib.Path(__file__).with_name("deploy-backend.py"))
deploy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(deploy)

DIGEST = "sha256:" + "a" * 64
RUNNING = {
    "taskDefinitionArn": "arn:aws:ecs:eu-central-1:1:task-definition/taskfest-qa-backend:4",
    "family": "taskfest-qa-backend",
    "revision": 4,
    "status": "ACTIVE",
    "taskRoleArn": "arn:task",
    "executionRoleArn": "arn:exec",
    "networkMode": "awsvpc",
    "containerDefinitions": [{"name": "backend", "image": "x/quay/ghilling/taskfest-backend:0.4.0@sha256:" + "b" * 64,
                              "environment": [{"name": "A", "value": "1"}]}],
    "requiresCompatibilities": ["FARGATE"],
    "cpu": "512",
    "memory": "1024",
    "registeredAt": "2026-10-06T12:00:00Z",
    "registeredBy": "arn:someone",
    "compatibilities": ["EC2", "FARGATE"],
    "requiresAttributes": [],
}


class ImageTest(unittest.TestCase):

    def test_the_release_is_pulled_through_this_accounts_cache_by_version_and_digest(self):
        self.assertEqual(
            deploy.image_reference("1", "eu-central-1", "v0.5.0", DIGEST),
            f"1.dkr.ecr.eu-central-1.amazonaws.com/quay/ghilling/taskfest-backend:0.5.0@{DIGEST}")

    def test_the_running_version_is_read_from_the_image_tag(self):
        self.assertEqual(deploy.version_of("x/quay/ghilling/taskfest-backend:0.4.0@" + DIGEST), "v0.4.0")
        self.assertEqual(deploy.version_of("quay.io/ghilling/taskfest-backend:0.4.0"), "v0.4.0")

    def test_latest_is_no_version(self):
        self.assertIsNone(deploy.version_of("x/quay/ghilling/taskfest-backend:latest"))


class TaskDefinitionTest(unittest.TestCase):

    def test_the_new_revision_differs_from_the_running_one_in_the_image_only(self):
        new = deploy.next_task_definition(RUNNING, "new-image")
        self.assertEqual(new["containerDefinitions"][0]["image"], "new-image")
        self.assertEqual(new["containerDefinitions"][0]["environment"], [{"name": "A", "value": "1"}])
        self.assertEqual(new["family"], "taskfest-qa-backend")
        self.assertEqual(new["taskRoleArn"], "arn:task")

    def test_fields_aws_sets_itself_are_not_sent_back(self):
        new = deploy.next_task_definition(RUNNING, "new-image")
        for field in ("taskDefinitionArn", "revision", "status", "registeredAt", "registeredBy",
                      "compatibilities", "requiresAttributes"):
            self.assertNotIn(field, new)

    def test_the_running_definition_is_left_untouched(self):
        deploy.next_task_definition(RUNNING, "new-image")
        self.assertTrue(RUNNING["containerDefinitions"][0]["image"].endswith("b" * 64))


def revision(number, registered_by, status="ACTIVE", variables=(("A", "1"),)):
    """A backend task definition as describe-task-definition returns it."""
    return {**RUNNING, "taskDefinitionArn": f"arn:aws:ecs:eu-central-1:1:task-definition/taskfest-qa-backend:{number}",
            "revision": number, "status": status, "registeredBy": registered_by,
            "containerDefinitions": [{**RUNNING["containerDefinitions"][0],
                                      "environment": [{"name": n, "value": v} for n, v in variables]}]}


DEPLOY = "arn:aws:sts::1:assumed-role/taskfest-qa-deploy/GitHubActions"
ADMIN = "arn:aws:sts::1:assumed-role/taskfest-qa-lifecycle/gunnar"


class AppliedRevisionTest(unittest.TestCase):
    """Which revision's configuration a deploy carries: the one last applied, not a deploy's copy (#189)."""

    def describe(self, *revisions):
        by_name = {f"taskfest-qa-backend:{r['revision']}": r for r in revisions}
        newest = max((r for r in revisions if r["status"] == "ACTIVE"), key=lambda r: r["revision"])
        by_name["taskfest-qa-backend"] = newest
        return lambda name: by_name[name]

    def test_an_applied_revision_newer_than_the_running_one_is_carried(self):
        running = revision(5, DEPLOY)
        applied = revision(6, ADMIN, variables=(("A", "1"), ("NEW", "2")))
        self.assertIs(applied, deploy.applied_revision(self.describe(running, applied), running, "taskfest-qa-deploy"))

    def test_an_apply_during_a_deploy_is_not_buried_by_the_deploys_copy(self):
        # Running 6; an apply registers 7 while a deploy, which read 6, registers 8 as a copy of it.
        running = revision(8, DEPLOY)
        applied = revision(7, ADMIN, variables=(("A", "1"), ("NEW", "2")))
        older = revision(6, DEPLOY)
        self.assertIs(applied, deploy.applied_revision(self.describe(older, applied, running), running,
                                                       "taskfest-qa-deploy"))

    def test_with_only_deploys_copies_left_the_running_one_is_carried(self):
        # After down and up's own revision was replaced, say: nothing applied is active.
        running = revision(9, DEPLOY)
        self.assertIs(running, deploy.applied_revision(self.describe(revision(8, DEPLOY), running), running,
                                                       "taskfest-qa-deploy"))

    def test_an_inactive_applied_revision_does_not_count(self):
        running = revision(5, DEPLOY)
        self.assertIs(running, deploy.applied_revision(
            self.describe(revision(4, ADMIN, status="INACTIVE"), running), running, "taskfest-qa-deploy"))

    def test_a_family_with_nothing_active_falls_back_to_the_running_revision(self):
        running = revision(5, ADMIN, status="INACTIVE")

        def nothing_active(name):
            raise LookupError(name)
        self.assertIs(running, deploy.applied_revision(nothing_active, running, "taskfest-qa-deploy"))

    def test_the_applied_configuration_reaches_the_new_revision(self):
        running = revision(5, DEPLOY)
        applied = revision(6, ADMIN, variables=(("A", "1"), ("NEW", "2")))
        base = deploy.applied_revision(self.describe(running, applied), running, "taskfest-qa-deploy")
        new = deploy.next_task_definition(base, "new-image")
        self.assertIn({"name": "NEW", "value": "2"}, new["containerDefinitions"][0]["environment"])
        self.assertEqual("new-image", new["containerDefinitions"][0]["image"])


class RedeployImageTest(unittest.TestCase):
    """Redeploying the running version keeps its exact image: a configuration rollout changes nothing else."""

    def test_the_running_version_keeps_its_image(self):
        running_image = RUNNING["containerDefinitions"][0]["image"]
        self.assertEqual(running_image, deploy.image_to_deploy(running_image, "v0.4.0", lambda: "resolved"))

    def test_another_version_is_resolved_on_quay(self):
        running_image = RUNNING["containerDefinitions"][0]["image"]
        self.assertEqual("resolved", deploy.image_to_deploy(running_image, "v0.5.0", lambda: "resolved"))


class DecideTest(unittest.TestCase):

    def test_an_environment_that_is_down_is_skipped(self):
        self.assertEqual(deploy.decide(service_active=False, migrations_differ=False).kind, "skip")

    def test_a_release_with_a_migration_takes_the_downtime_path(self):
        action = deploy.decide(service_active=True, migrations_differ=True)
        self.assertEqual(action.kind, "downtime")
        self.assertIn("migration", action.reason)

    def test_anything_else_is_deployed_blue_green(self):
        self.assertEqual(deploy.decide(service_active=True, migrations_differ=False).kind, "deploy")

    def test_rolling_back_across_a_migration_is_refused(self):
        # The older release's Liquibase ignores the newer changesets and exits 0, so the downtime
        # path would start it against a schema it was not built for. The way back is a restore.
        action = deploy.decide(service_active=True, migrations_differ=True, downgrade=True)
        self.assertEqual(action.kind, "stop")
        self.assertIn("snapshot", action.reason)

    def test_rolling_back_without_a_migration_is_an_ordinary_deploy(self):
        self.assertEqual(deploy.decide(service_active=True, migrations_differ=False, downgrade=True).kind, "deploy")


class OlderTest(unittest.TestCase):

    def test_an_earlier_release_is_older(self):
        self.assertTrue(deploy.is_older("v1.2.2", "v1.2.3"))
        self.assertTrue(deploy.is_older("v1.9.0", "v1.10.0"))

    def test_the_same_or_a_later_release_is_not(self):
        self.assertFalse(deploy.is_older("v1.2.3", "v1.2.3"))
        self.assertFalse(deploy.is_older("v1.3.0", "v1.2.3"))

    def test_a_pre_release_is_older_than_its_final_release(self):
        self.assertTrue(deploy.is_older("v1.2.3-rc.1", "v1.2.3"))
        self.assertFalse(deploy.is_older("v1.2.3", "v1.2.3-rc.1"))



class ArchitectureTest(unittest.TestCase):
    """Graviton (#250): a release before v0.15.0 has no arm64 image (#249) and cannot start there."""

    def test_an_arm64_environment_refuses_a_release_without_an_arm64_image(self):
        action = deploy.decide(service_active=True, migrations_differ=False, without_arm64=True)
        self.assertEqual(action.kind, "stop")
        self.assertIn("arm64", action.reason)

    def test_a_release_has_an_arm64_image_from_v0_15_0_on(self):
        self.assertTrue(deploy.has_arm64_image("v0.15.0"))
        self.assertTrue(deploy.has_arm64_image("v1.0.0"))
        self.assertFalse(deploy.has_arm64_image("v0.14.0"))

    def test_the_environment_runs_arm64_when_its_configuration_says_so(self):
        self.assertTrue(deploy.runs_on_arm64({"runtimePlatform": {"cpuArchitecture": "ARM64"}}))
        self.assertFalse(deploy.runs_on_arm64({"runtimePlatform": {"cpuArchitecture": "X86_64"}}))
        self.assertFalse(deploy.runs_on_arm64({}))

class RolloutTest(unittest.TestCase):
    """Waiting is reading the new deployment's rolloutState, not ECS's ten-minute stable waiter."""

    NEW = "arn:aws:ecs:eu-central-1:1:task-definition/taskfest-qa-backend:5"
    OLD = RUNNING["taskDefinitionArn"]

    def services(self, *deployments):
        return {"services": [{"deployments": [
            {"taskDefinition": arn, "rolloutState": state} for arn, state in deployments]}]}

    def test_the_rollout_is_in_progress_while_traffic_shifts_or_bakes(self):
        state = deploy.rollout_state(self.services((self.NEW, "IN_PROGRESS"), (self.OLD, "COMPLETED")), self.NEW)
        self.assertEqual("IN_PROGRESS", state)

    def test_it_is_done_when_the_new_deployment_completes(self):
        self.assertEqual("COMPLETED", deploy.rollout_state(self.services((self.NEW, "COMPLETED")), self.NEW))

    def test_a_failed_rollout_is_reported(self):
        self.assertEqual("FAILED", deploy.rollout_state(self.services((self.NEW, "FAILED")), self.NEW))

    def test_a_deployment_not_listed_is_missing(self):
        self.assertEqual("MISSING", deploy.rollout_state(self.services((self.OLD, "IN_PROGRESS")), self.NEW))

    def test_a_deployment_not_listed_yet_is_waited_for(self):
        # describe-services is eventually consistent: right after update-service it may not show.
        self.assertEqual("IN_PROGRESS", deploy.next_state("MISSING", seen=False))

    def test_a_deployment_that_vanished_after_being_seen_was_rolled_back(self):
        # ECS replaces a rolled-back deployment with one for the previous task definition.
        self.assertEqual("FAILED", deploy.next_state("MISSING", seen=True))

    def test_a_listed_deployment_reports_its_own_state(self):
        self.assertEqual("COMPLETED", deploy.next_state("COMPLETED", seen=True))


class StartupImageTest(unittest.TestCase):
    """What `env.sh up` starts: never a release past what the running environment has."""

    RUNNING_IMAGE = RUNNING["containerDefinitions"][0]["image"]

    def test_an_environment_that_is_up_keeps_the_release_it_runs(self):
        # Deploying to it is deploy-backend.py's job, with the migration check; up must not let
        # `migrate` reach a release that check stopped.
        choice = deploy.startup_choice(True, self.RUNNING_IMAGE, "v0.5.0")
        self.assertEqual(("keep", self.RUNNING_IMAGE), choice)

    def test_an_environment_that_is_down_starts_the_named_release(self):
        self.assertEqual(("release", "v0.5.0"), deploy.startup_choice(False, None, "v0.5.0"))

    def test_an_environment_that_is_down_needs_a_release_named(self):
        kind, _ = deploy.startup_choice(False, None, None)
        self.assertEqual("error", kind)



class DowntimeTest(unittest.TestCase):
    """The downtime path (#215): stop, snapshot, migrate, start -- and what each failure leaves."""

    def test_the_steps_run_in_this_order(self):
        self.assertEqual(deploy.DOWNTIME_STEPS, ("stop", "snapshot", "migrate", "start"))

    def test_before_the_migration_a_failure_restarts_the_old_version(self):
        # The schema is untouched until `migrate` runs, so what ran before can run again.
        self.assertEqual(deploy.after_failure("stop"), "restart")
        self.assertEqual(deploy.after_failure("snapshot"), "restart")

    def test_a_migration_that_never_started_restarts_the_old_version(self):
        # RunTask can refuse to place a task at all (capacity, ENIs): the schema is still untouched.
        self.assertEqual(deploy.after_failure("migrate", migrated=False), "restart")

    def test_the_start_turns_off_the_rollback_and_keeps_the_rest(self):
        # ECS's rollback would bring the old version back against the migrated schema.
        configuration = {"strategy": "BLUE_GREEN", "bakeTimeInMinutes": 5,
                         "deploymentCircuitBreaker": {"enable": True, "rollback": True}}
        self.assertEqual(deploy.without_rollback(configuration),
                         {"strategy": "BLUE_GREEN", "bakeTimeInMinutes": 5,
                          "deploymentCircuitBreaker": {"enable": True, "rollback": False}})
        self.assertTrue(configuration["deploymentCircuitBreaker"]["rollback"])

    def test_from_the_migration_on_a_failure_leaves_the_service_down(self):
        # Neither version may run against a schema it was not built for, or against a half-migrated one.
        self.assertEqual(deploy.after_failure("migrate"), "stay-down")
        self.assertEqual(deploy.after_failure("start"), "stay-down")

    def test_the_snapshot_is_named_after_the_environment_and_the_release(self):
        self.assertEqual(deploy.snapshot_identifier("qa", "v0.11.0", "20261008-201530"),
                         "taskfest-qa-db-pre-release-v0-11-0-20261008-201530")

    def test_a_pre_release_suffix_becomes_a_valid_identifier(self):
        # RDS allows letters, digits and single hyphens only.
        self.assertEqual(deploy.snapshot_identifier("prod", "v1.2.0-rc.1", "20261008-201530"),
                         "taskfest-prod-db-pre-release-v1-2-0-rc-1-20261008-201530")


def _snapshot(name, created, status="available"):
    return {"DBSnapshotIdentifier": name, "SnapshotCreateTime": created, "Status": status}


class SnapshotRetentionTest(unittest.TestCase):
    """Keep the newest three pre-release snapshots per environment (D3 on #215), and nothing else is touched."""

    def test_only_the_newest_three_are_kept(self):
        snapshots = [_snapshot(f"taskfest-qa-db-pre-release-v0-{n}-0-x", f"2026-10-0{n}T10:00:00Z") for n in range(1, 6)]
        self.assertEqual(deploy.snapshots_to_delete(snapshots, "qa"),
                         ["taskfest-qa-db-pre-release-v0-2-0-x", "taskfest-qa-db-pre-release-v0-1-0-x"])

    def test_final_snapshots_are_never_deleted(self):
        # They are what `env.sh up` restores after a teardown.
        snapshots = [_snapshot(f"taskfest-qa-db-final-2026100{n}", f"2026-10-0{n}T10:00:00Z") for n in range(1, 6)]
        self.assertEqual(deploy.snapshots_to_delete(snapshots, "qa"), [])

    def test_the_other_environments_snapshots_are_not_counted(self):
        snapshots = [_snapshot(f"taskfest-prod-db-pre-release-v0-{n}-0-x", f"2026-10-0{n}T10:00:00Z") for n in range(1, 6)]
        self.assertEqual(deploy.snapshots_to_delete(snapshots, "qa"), [])

    def test_one_still_being_created_is_neither_counted_nor_deleted(self):
        snapshots = [_snapshot(f"taskfest-qa-db-pre-release-v0-{n}-0-x", f"2026-10-0{n}T10:00:00Z") for n in range(1, 4)]
        snapshots.append(_snapshot("taskfest-qa-db-pre-release-v0-9-0-x", "2026-10-09T10:00:00Z", "creating"))
        self.assertEqual(deploy.snapshots_to_delete(snapshots, "qa"), [])


class MigrationTaskTest(unittest.TestCase):

    def test_it_runs_in_the_services_network(self):
        service = {"networkConfiguration": {"awsvpcConfiguration": {
            "subnets": ["subnet-a", "subnet-b"], "securityGroups": ["sg-1"], "assignPublicIp": "ENABLED"}}}
        self.assertEqual(deploy.task_network(service),
                         {"awsvpcConfiguration": {"subnets": ["subnet-a", "subnet-b"],
                                                  "securityGroups": ["sg-1"], "assignPublicIp": "ENABLED"}})

    def test_exit_code_zero_is_success(self):
        task = {"containers": [{"exitCode": 0}], "stoppedReason": "Essential container in task exited"}
        self.assertEqual(deploy.task_outcome(task), (True, "exit code 0"))

    def test_another_exit_code_is_a_failure(self):
        task = {"containers": [{"exitCode": 1}], "stoppedReason": "Essential container in task exited"}
        self.assertEqual(deploy.task_outcome(task), (False, "exit code 1"))

    def test_a_container_that_never_ran_is_explained_by_the_stopped_reason(self):
        task = {"containers": [{}], "stoppedReason": "CannotPullContainerError: not found"}
        self.assertEqual(deploy.task_outcome(task), (False, "it never ran: CannotPullContainerError: not found"))


if __name__ == "__main__":
    unittest.main()


class PreviewTest(unittest.TestCase):
    """What the approval compares with (#215): what the environment reports it runs, when it can."""

    def test_the_reported_release_is_compared_with(self):
        self.assertEqual(deploy.preview_base({"version": "0.11.0"}, "v0.12.0"), ("v0.11.0", "running"))

    def test_a_pre_release_is_a_release(self):
        self.assertEqual(deploy.preview_base({"version": "1.0.0-rc.1"}, "v0.12.0"), ("v1.0.0-rc.1", "running"))

    def test_a_snapshot_build_falls_back_to_the_previous_release(self):
        self.assertEqual(deploy.preview_base({"version": "1.0.0-SNAPSHOT"}, "v0.12.0"), ("v0.12.0", "previous"))

    def test_no_answer_falls_back_to_the_previous_release(self):
        # Down, or a release from before /api/version existed.
        self.assertEqual(deploy.preview_base(None, "v0.12.0"), ("v0.12.0", "previous"))
        self.assertEqual(deploy.preview_base({"unexpected": 1}, "v0.12.0"), ("v0.12.0", "previous"))
