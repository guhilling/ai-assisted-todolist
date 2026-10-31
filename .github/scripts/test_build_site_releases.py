"""
Pins down which releases the documentation site publishes, and which it calls the latest (#433):
a pre-release such as v1.3.0-rc.1 comes after its final release, not above it, and "latest" is the
newest final release, as it is on GitHub.

Each test tags commits in a throwaway repository, every one carrying the contract.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import importlib.util
import os
import pathlib
import subprocess
import tempfile
import unittest
from unittest import mock

_spec = importlib.util.spec_from_file_location("build_site", pathlib.Path(__file__).with_name("build-site.py"))
site = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(site)


class ReleaseTagsTest(unittest.TestCase):

    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.repo = pathlib.Path(self.work.name)
        self.git("init", "-q")
        (self.repo / "doc" / "api").mkdir(parents=True)

    def tearDown(self):
        self.work.cleanup()

    def git(self, *args):
        # Not the developer's own configuration: a signed tag would want a message and a key.
        subprocess.run(["git", "-c", "user.name=Test", "-c", "user.email=test@example.com", *args],
                       cwd=self.repo, check=True, capture_output=True,
                       env={**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"})

    def release(self, *tags):
        for tag in tags:
            (self.repo / "doc" / "api" / "openapi.json").write_text(f'{{"version": "{tag}"}}')
            self.git("add", "-A")
            self.git("commit", "-q", "-m", tag)
            self.git("tag", tag)

    def tags(self):
        with mock.patch.object(site, "REPO", self.repo):
            return site.release_tags()

    def test_a_final_release_comes_before_its_pre_release(self):
        self.release("v1.2.0", "v1.3.0-rc.1", "v1.3.0")

        self.assertEqual(self.tags(), ["v1.3.0", "v1.3.0-rc.1", "v1.2.0"])

    def test_the_latest_is_the_newest_final_release(self):
        self.release("v1.2.0", "v1.3.0-rc.1")

        self.assertEqual(site.latest_release(self.tags()), "v1.2.0")

    def test_a_tag_that_is_no_version_is_never_the_latest(self):
        self.release("v1.2.0", "v1.3")

        self.assertEqual(site.latest_release(self.tags()), "v1.2.0")

    def test_only_ascii_digits_make_a_final_release(self):
        # Python's \d also takes other scripts' digits, which git allows in a tag name.
        self.assertEqual(site.latest_release(["v1.2.\u0663", "v1.2.0"]), "v1.2.0")

    def test_there_is_no_latest_without_a_final_release(self):
        self.release("v0.1.0-rc.1")

        self.assertIsNone(site.latest_release(self.tags()))


if __name__ == "__main__":
    unittest.main()
