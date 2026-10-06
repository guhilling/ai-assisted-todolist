"""
Pins down the decisions deploy-backend.py makes, without AWS, Quay or git (#181).

Deploying is: find the release's image by digest, decide whether this environment can take it
blue/green, and register a task definition that differs from the running one in the image only.
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


class DecideTest(unittest.TestCase):

    def test_an_environment_that_is_down_is_skipped(self):
        self.assertEqual(deploy.decide(service_active=False, migrations_differ=False).kind, "skip")

    def test_a_release_with_a_migration_is_stopped_before_any_traffic_moves(self):
        action = deploy.decide(service_active=True, migrations_differ=True)
        self.assertEqual(action.kind, "stop")
        self.assertIn("migration", action.reason)

    def test_anything_else_is_deployed_blue_green(self):
        self.assertEqual(deploy.decide(service_active=True, migrations_differ=False).kind, "deploy")


if __name__ == "__main__":
    unittest.main()
