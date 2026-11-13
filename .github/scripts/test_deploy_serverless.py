"""
Pins down what deploy-serverless.py does, without AWS (#555).

Deploying the Go backend is: upload each function's code from the release, publish it as a version
named after the release, check that the API function's new version starts and answers, and only
then move each function's alias `live`, which everything that calls a function names. Getting that
wrong serves code nobody checked, or leaves the functions on different releases.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import importlib.util
import json
import pathlib
import tempfile
import unittest

_spec = importlib.util.spec_from_file_location(
    "deploy_serverless", pathlib.Path(__file__).with_name("deploy-serverless.py"))
deploy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(deploy)


class FakeLambda:
    """The AWS CLI's Lambda commands, as far as the deploy uses them, recording every call."""

    def __init__(self, answer=403, function_error=None, fail_publishing=None):
        self.calls = []
        self.versions = {}
        self.aliases = {name: "3" for name in self.names()}
        self.answer = answer
        self.function_error = function_error
        self.fail_publishing = fail_publishing

    @staticmethod
    def names():
        return [f"taskfest-qa-{command}" for command in deploy.FUNCTIONS]

    def __call__(self, *args):
        self.calls.append(args)
        command = args[1]
        name = self._value(args, "--function-name")
        if command == "publish-version":
            if name == self.fail_publishing:
                raise RuntimeError(f"publishing {name} failed")
            self.versions[name] = str(int(self.versions.get(name, "3")) + 1)
            return {"Version": self.versions[name], "Description": self._value(args, "--description")}
        if command == "get-alias":
            return {"FunctionVersion": self.aliases[name]}
        if command == "update-alias":
            self.aliases[name] = self._value(args, "--function-version")
            return {}
        if command == "invoke":
            out = args[-1]
            pathlib.Path(out).write_text(json.dumps({"statusCode": self.answer}))
            return {"StatusCode": 200, **({"FunctionError": self.function_error} if self.function_error else {})}
        return {}

    @staticmethod
    def _value(args, flag):
        return args[args.index(flag) + 1] if flag in args else None

    def commands(self, name):
        return [args[1] for args in self.calls if self._value(args, "--function-name") == name]


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

        for name in FakeLambda.names():
            self.assertEqual(aws.aliases[name], "4", name)
            self.assertEqual(aws.commands(name)[:3], ["update-function-code", "wait", "publish-version"], name)
        published = [args for args in aws.calls if args[1] == "publish-version"]
        self.assertEqual({args[args.index("--description") + 1] for args in published}, {"v1.6.0"})
        uploaded = [args[args.index("--zip-file") + 1] for args in aws.calls if args[1] == "update-function-code"]
        self.assertEqual(uploaded, [f"fileb://{self.dist}/taskfest-serverless-1.6.0-{c}.zip" for c in deploy.FUNCTIONS])

    def test_the_api_is_checked_before_any_alias_moves(self):
        aws = FakeLambda()

        deploy.deploy("qa", "v1.6.0", self.dist, aws=aws)

        first_move = next(i for i, args in enumerate(aws.calls) if args[1] == "update-alias")
        checks = [i for i, args in enumerate(aws.calls) if args[1] == "invoke"]
        self.assertEqual(len(checks), 1)
        self.assertLess(checks[0], first_move)
        invoke = aws.calls[checks[0]]
        self.assertEqual(invoke[invoke.index("--qualifier") + 1], "4")
        self.assertIn("taskfest-qa-api", invoke)

    def test_an_api_that_does_not_answer_as_it_should_moves_no_alias(self):
        for aws in (FakeLambda(answer=500), FakeLambda(function_error="Unhandled")):
            with self.subTest(answer=aws.answer, error=aws.function_error):
                with self.assertRaises(SystemExit):
                    deploy.deploy("qa", "v1.6.0", self.dist, aws=aws)
                self.assertEqual(set(aws.aliases.values()), {"3"})
                self.assertFalse(any(args[1] == "update-alias" for args in aws.calls))

    def test_aliases_already_moved_go_back_when_a_later_function_fails(self):
        aws = FakeLambda(fail_publishing="taskfest-qa-orphans")

        with self.assertRaises(RuntimeError):
            deploy.deploy("qa", "v1.6.0", self.dist, aws=aws)

        self.assertEqual(set(aws.aliases.values()), {"3"})

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


if __name__ == "__main__":
    unittest.main()
