"""
Pins down what deploy-serverless.py does, without AWS (#555).

Deploying the Go backend is: upload each function's code from the release and publish exactly that
code as a version named after the release; check that the API function's new version starts and
answers; and only then move every function's alias `live`, which everything that calls a function
names. Getting that wrong serves code nobody checked, or leaves the functions on different releases.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest import mock

_spec = importlib.util.spec_from_file_location(
    "deploy_serverless", pathlib.Path(__file__).with_name("deploy-serverless.py"))
deploy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(deploy)

NAMES = [f"taskfest-qa-{command}" for command in deploy.FUNCTIONS]


class FakeLambda:
    """The AWS CLI's Lambda commands, as far as the deploy uses them, recording every call."""

    def __init__(self, answer=403, function_error=None, fail_publishing=None, aliases="3", fail_moving_back=None):
        self.calls = []
        self.versions = {name: 3 for name in NAMES}
        self.aliases = {name: aliases for name in NAMES}
        self.code = {}
        self.answer = answer
        self.function_error = function_error
        self.fail_publishing = fail_publishing
        self.fail_moving_back = fail_moving_back

    def __call__(self, *args):
        self.calls.append(args)
        command = args[1]
        name = self.value(args, "--function-name")
        if command == "update-function-code":
            self.code[name] = f"sha-of-{self.value(args, '--zip-file')}"
            return {"CodeSha256": self.code[name]}
        if command == "publish-version":
            if name == self.fail_publishing:
                raise RuntimeError(f"publishing {name} failed")
            self.versions[name] += 1
            return {"Version": str(self.versions[name])}
        if command == "get-alias":
            return {"FunctionVersion": self.aliases[name]}
        if command == "update-alias":
            target = self.value(args, "--function-version")
            if name == self.fail_moving_back and target == "3":
                raise RuntimeError(f"moving {name} back failed")
            self.aliases[name] = target
            return {}
        if command == "invoke":
            pathlib.Path(args[-1]).write_text(json.dumps({"statusCode": self.answer}))
            return {"StatusCode": 200, **({"FunctionError": self.function_error} if self.function_error else {})}
        return {}

    @staticmethod
    def value(args, flag):
        return args[args.index(flag) + 1] if flag in args else None

    def index(self, command, name=None):
        return [i for i, args in enumerate(self.calls)
                if args[1] == command and (name is None or self.value(args, "--function-name") == name)]


def release_zips(directory):
    for command in deploy.FUNCTIONS:
        (pathlib.Path(directory) / f"taskfest-serverless-1.6.0-{command}.zip").write_bytes(b"zip")


class Deploying(unittest.TestCase):
    def setUp(self):
        self.dist = tempfile.mkdtemp()
        release_zips(self.dist)

    def test_each_function_gets_the_release_as_a_version_and_its_alias_moves_to_it(self):
        aws = FakeLambda()

        deploy.deploy("qa", "v1.6.0", self.dist, aws=aws)

        self.assertEqual(aws.aliases, {name: "4" for name in NAMES})
        uploaded = [FakeLambda.value(aws.calls[i], "--zip-file") for i in aws.index("update-function-code")]
        self.assertEqual(uploaded, [f"fileb://{self.dist}/taskfest-serverless-1.6.0-{c}.zip" for c in deploy.FUNCTIONS])
        for i in aws.index("publish-version"):
            args = aws.calls[i]
            name = FakeLambda.value(args, "--function-name")
            self.assertEqual(FakeLambda.value(args, "--description"), "v1.6.0")
            # Exactly the code uploaded, not whatever someone else put there meanwhile.
            self.assertEqual(FakeLambda.value(args, "--code-sha256"), aws.code[name])

    def test_every_function_is_published_and_the_api_checked_before_any_alias_moves(self):
        aws = FakeLambda()

        deploy.deploy("qa", "v1.6.0", self.dist, aws=aws)

        first_move = min(aws.index("update-alias"))
        self.assertLess(max(aws.index("publish-version")), first_move)
        checks = aws.index("invoke")
        self.assertEqual(len(checks), 1)
        self.assertLess(checks[0], first_move)
        invoke = aws.calls[checks[0]]
        self.assertEqual(FakeLambda.value(invoke, "--qualifier"), "4")
        self.assertEqual(FakeLambda.value(invoke, "--function-name"), "taskfest-qa-api")

    def test_an_api_that_does_not_answer_as_it_should_moves_no_alias(self):
        for aws in (FakeLambda(answer=500), FakeLambda(function_error="Unhandled")):
            with self.subTest(answer=aws.answer, error=aws.function_error):
                with self.assertRaises(SystemExit):
                    deploy.deploy("qa", "v1.6.0", self.dist, aws=aws)
                self.assertEqual(set(aws.aliases.values()), {"3"})
                self.assertEqual(aws.index("update-alias"), [])

    def test_a_function_that_cannot_be_published_moves_no_alias(self):
        aws = FakeLambda(fail_publishing="taskfest-qa-orphans")

        with self.assertRaises(RuntimeError):
            deploy.deploy("qa", "v1.6.0", self.dist, aws=aws)

        self.assertEqual(set(aws.aliases.values()), {"3"})

    def test_an_alias_still_on_the_unpublished_code_is_pinned_before_the_upload_changes_that_code(self):
        # As OpenTofu creates them: an upload would otherwise serve the new code before its check.
        aws = FakeLambda(aliases="$LATEST", answer=500)

        with self.assertRaises(SystemExit):
            deploy.deploy("qa", "v1.6.0", self.dist, aws=aws)

        for name in NAMES:
            self.assertLess(min(aws.index("update-alias", name)), min(aws.index("update-function-code", name)), name)
        self.assertEqual(aws.aliases, {name: "4" for name in NAMES})

    def test_every_alias_moved_goes_back_when_a_later_one_fails_even_if_one_cannot(self):
        aws = FakeLambda(fail_moving_back="taskfest-qa-streams")

        def moving(*args):
            # replay's alias fails to move forward -- perhaps after it did, so it goes back too.
            if (args[1] == "update-alias" and FakeLambda.value(args, "--function-name") == "taskfest-qa-replay"
                    and FakeLambda.value(args, "--function-version") != "3"):
                raise RuntimeError("moving replay failed")
            return aws(*args)

        with self.assertRaises(RuntimeError):
            deploy.deploy("qa", "v1.6.0", self.dist, aws=moving)

        # streams could not go back; the others did, replay's included, which may have moved.
        self.assertEqual(aws.aliases["taskfest-qa-api"], "3")
        self.assertEqual(aws.aliases["taskfest-qa-orphans"], "3")
        self.assertEqual(aws.aliases["taskfest-qa-streams"], "4")
        self.assertIn("taskfest-qa-replay", [FakeLambda.value(aws.calls[i], "--function-name")
                                             for i in aws.index("update-alias")
                                             if FakeLambda.value(aws.calls[i], "--function-version") == "3"])

    def test_only_a_release_tag_is_deployed(self):
        for version in ("1.6.0", "v1.6", "latest", "v1.6.0; rm -rf /"):
            with self.subTest(version=version):
                with self.assertRaises(SystemExit):
                    deploy.deploy("qa", version, self.dist, aws=FakeLambda())

    def test_a_missing_function_is_refused_before_anything_is_uploaded(self):
        (pathlib.Path(self.dist) / "taskfest-serverless-1.6.0-replay.zip").unlink()
        aws = FakeLambda()

        with self.assertRaises(SystemExit):
            deploy.deploy("qa", "v1.6.0", self.dist, aws=aws)

        self.assertEqual(aws.calls, [])


class TheCli(unittest.TestCase):
    def test_a_failing_command_says_what_aws_answered(self):
        failure = subprocess.CalledProcessError(254, ["aws"], stderr="AccessDeniedException: no GetFunction")
        with mock.patch.object(deploy.subprocess, "run", side_effect=failure), \
                mock.patch("sys.stderr") as stderr:
            with self.assertRaises(subprocess.CalledProcessError):
                deploy.aws("lambda", "get-function")
        written = "".join(call.args[0] for call in stderr.write.call_args_list)
        self.assertIn("AccessDeniedException: no GetFunction", written)


if __name__ == "__main__":
    unittest.main()
