"""
Pins down which AWS profile deployment/aws-tofu/env.sh uses, and that it stops on one that assumes
no role -- before OpenTofu or AWS is reached.

`AWS_PROFILE=hilling-it env.sh down qa` failed with a 403 on the state bucket: the profile was the
IAM user itself, which may assume the lifecycle role but holds none of its permissions. Now the
profile is chosen per environment (TASKFEST_QA_AWS_PROFILE, TASKFEST_PROD_AWS_PROFILE), then
AWS_PROFILE, then taskfest-<env>-lifecycle, and one without a role_arn or an SSO role is refused.

Each test runs env.sh against a throwaway AWS config file, so nothing here signs a request; it
needs bash and the AWS CLI, whose `configure get` only reads that file.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

ENV_SH = pathlib.Path(__file__).resolve().parents[2] / "deployment" / "aws-tofu" / "env.sh"

CONFIG = """\
[profile plain]
credential_process = /bin/false

[profile other-plain]
region = eu-central-1

[profile with-role]
role_arn = arn:aws:iam::123456789012:role/taskfest-qa-lifecycle
source_profile = plain
"""


@unittest.skipUnless(shutil.which("aws") and shutil.which("bash"), "needs the AWS CLI and bash")
class ProfileChoiceTest(unittest.TestCase):

    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        config = pathlib.Path(self.home.name) / "config"
        config.write_text(CONFIG)
        self.env = {
            "PATH": os.environ["PATH"],
            "HOME": self.home.name,
            "AWS_CONFIG_FILE": str(config),
            "AWS_SHARED_CREDENTIALS_FILE": str(pathlib.Path(self.home.name) / "credentials"),
        }

    def tearDown(self):
        self.home.cleanup()

    def run_env_sh(self, *args, **variables):
        return subprocess.run(["bash", str(ENV_SH), *args], env={**self.env, **variables},
                              capture_output=True, text=True, timeout=60)

    def test_a_plain_user_profile_is_refused(self):
        result = self.run_env_sh("down", "qa", AWS_PROFILE="plain")

        self.assertEqual(result.returncode, 1)
        self.assertIn("plain", result.stderr)
        self.assertIn("assumes no role", result.stderr)
        self.assertIn("AWS_PROFILE", result.stderr)

    def test_the_environments_own_variable_comes_first(self):
        # A global AWS_PROFILE is what got in the way; the per-environment choice wins over it.
        result = self.run_env_sh("down", "qa", AWS_PROFILE="with-role", TASKFEST_QA_AWS_PROFILE="other-plain")

        self.assertEqual(result.returncode, 1)
        self.assertIn("other-plain", result.stderr)
        self.assertIn("TASKFEST_QA_AWS_PROFILE", result.stderr)

    def test_each_environment_has_its_own_variable(self):
        result = self.run_env_sh("up", "prod", "v1.2.3", TASKFEST_PROD_AWS_PROFILE="plain",
                                 TASKFEST_QA_AWS_PROFILE="with-role")

        self.assertEqual(result.returncode, 1)
        self.assertIn("TASKFEST_PROD_AWS_PROFILE", result.stderr)

    def test_a_chosen_profile_that_does_not_exist_is_refused(self):
        result = self.run_env_sh("migrate", "qa", TASKFEST_QA_AWS_PROFILE="nowhere")

        self.assertEqual(result.returncode, 1)
        self.assertIn("nowhere", result.stderr)
        self.assertIn("not configured", result.stderr)



@unittest.skipUnless(shutil.which("aws") and shutil.which("bash"), "needs the AWS CLI and bash")
class AccountTest(unittest.TestCase):
    """`env.sh account` applies the account-wide root, as an administrator: there is no default
    profile for it, and a plain user is refused like anywhere else."""

    setUp = ProfileChoiceTest.setUp
    tearDown = ProfileChoiceTest.tearDown
    run_env_sh = ProfileChoiceTest.run_env_sh

    def test_a_profile_must_be_named(self):
        result = self.run_env_sh("account")

        self.assertEqual(result.returncode, 1)
        self.assertIn("TASKFEST_ACCOUNT_AWS_PROFILE", result.stderr)

    def test_its_own_variable_comes_first_and_a_plain_user_is_refused(self):
        result = self.run_env_sh("account", AWS_PROFILE="with-role", TASKFEST_ACCOUNT_AWS_PROFILE="plain")

        self.assertEqual(result.returncode, 1)
        self.assertIn("assumes no role", result.stderr)
        self.assertIn("TASKFEST_ACCOUNT_AWS_PROFILE", result.stderr)

    def test_aws_profile_is_used_when_its_own_variable_is_not_set(self):
        result = self.run_env_sh("account", AWS_PROFILE="other-plain")

        self.assertEqual(result.returncode, 1)
        self.assertIn("other-plain (from AWS_PROFILE)", result.stderr)

if __name__ == "__main__":
    unittest.main()
