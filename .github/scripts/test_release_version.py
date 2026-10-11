"""
Pins down which version cut-release.yml gives the next release (#297), without git or oasdiff.

The changes below are oasdiff's own `changelog --format json` output, trimmed of the source
positions: v0.17.0's API against main's (an addition), the same the other way round (a removal),
and main's against itself.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import importlib.util
import pathlib
import re
import unittest

_spec = importlib.util.spec_from_file_location(
    "release_version", pathlib.Path(__file__).with_name("release-version.py"))
release = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(release)

ADDED = [{
    "id": "response-required-property-added",
    "text": "added the required property `minimumAppVersion` to the response with the `200` status",
    "level": 1, "operation": "GET", "path": "/api/version", "section": "paths",
}]
REMOVED = [
    {
        "id": "response-required-property-removed",
        "text": "removed the required property `minimumAppVersion` from the response with the `200` status",
        "level": 3, "operation": "GET", "path": "/api/version", "section": "paths",
    },
    {
        "id": "api-version-not-bumped",
        "text": "a breaking change was detected but the version is still `1.0.0-SNAPSHOT`",
        "level": 1, "section": "info",
    },
]
UNCHANGED = []
# A warning is a change oasdiff cannot judge, such as a new enum value in a response: compatible
# for the app, which reads values it does not know as unknown (doc/releasing.md).
NEW_ENUM_VALUE = [{
    "id": "response-property-enum-value-added",
    "text": "added the new `ARCHIVED` enum value to the `state` response property",
    "level": 2, "operation": "GET", "path": "/api/tasks", "section": "paths",
}]


class LatestReleaseTest(unittest.TestCase):

    def test_the_highest_version_wins_by_number_not_by_text(self):
        self.assertEqual(release.latest_release(["v0.9.0", "v0.17.0", "v0.10.2"]), (0, 17, 0))

    def test_pre_releases_and_other_tags_are_ignored(self):
        tags = ["v1.2.0", "v1.3.0-rc.1", "v2.0.0-beta", "deploy-test", "1.4.0", "v1.2"]
        self.assertEqual(release.latest_release(tags), (1, 2, 0))

    def test_no_release_at_all_is_none(self):
        self.assertIsNone(release.latest_release(["deploy-test", "v1.0.0-rc.1"]))


class AfterOneTest(unittest.TestCase):
    """From 1.0.0 the API decides (doc/releasing.md)."""

    def test_a_breaking_change_gives_a_major(self):
        self.assertEqual(release.decide("auto", (1, 4, 2), REMOVED).version, "2.0.0")

    def test_an_addition_gives_a_minor(self):
        self.assertEqual(release.decide("auto", (1, 4, 2), ADDED).version, "1.5.0")

    def test_an_unchanged_api_gives_a_patch(self):
        self.assertEqual(release.decide("auto", (1, 4, 2), UNCHANGED).version, "1.4.3")

    def test_a_warning_alone_is_compatible_and_gives_a_minor(self):
        self.assertEqual(release.decide("auto", (1, 4, 2), NEW_ENUM_VALUE).version, "1.5.0")

    def test_the_documents_own_version_is_not_a_change_of_the_api(self):
        not_bumped = [change for change in REMOVED if change["id"] == "api-version-not-bumped"]
        self.assertEqual(release.decide("auto", (1, 4, 2), not_bumped).version, "1.4.3")

    def test_a_larger_step_than_the_api_needs_may_be_asked_for(self):
        self.assertEqual(release.decide("minor", (1, 4, 2), UNCHANGED).version, "1.5.0")
        self.assertEqual(release.decide("major", (1, 4, 2), ADDED).version, "2.0.0")

    def test_a_smaller_step_than_the_api_needs_is_refused(self):
        refused = release.decide("minor", (1, 4, 2), REMOVED)
        self.assertIsNone(refused.version)
        self.assertIn("major", refused.summary)
        self.assertIsNone(release.decide("patch", (1, 4, 2), ADDED).version)


class MajorPrerequisitesTest(unittest.TestCase):
    """A break of the API is released only with the two changes it needs (doc/releasing.md)."""

    def test_a_breaking_change_without_them_is_refused(self):
        refused = release.decide("auto", (1, 4, 2), REMOVED, missing=["oldest", "minimum"])
        self.assertIsNone(refused.version)
        self.assertIn("oldest", refused.summary)
        self.assertIn("minimum", refused.summary)

    def test_a_breaking_change_with_them_is_a_major(self):
        self.assertEqual(release.decide("auto", (1, 4, 2), REMOVED, missing=[]).version, "2.0.0")

    def test_a_major_asked_for_without_a_break_needs_neither(self):
        decided = release.decide("major", (1, 4, 2), ADDED, missing=["oldest", "minimum"])
        self.assertEqual(decided.version, "2.0.0")

    def test_under_0_x_they_are_not_asked_for(self):
        decided = release.decide("auto", (0, 17, 0), REMOVED, missing=["oldest", "minimum"])
        self.assertEqual(decided.version, "0.18.0")


class MissingPrerequisitesTest(unittest.TestCase):
    """Which of the two changes a major needs have not been made since the newest release."""

    PROPERTIES = """# a comment
taskfest.post-login-redirect-uri=${TASKFEST_AUTH_POST_LOGIN_REDIRECT_URI:/}
taskfest.minimum-app-version=${TASKFEST_MINIMUM_APP_VERSION:%s}
"""
    OLDEST = "# The oldest release whose API every newer backend still serves.\n%s\n"

    def files(self, oldest, minimum):
        return {release.OLDEST_SUPPORTED: self.OLDEST % oldest,
                release.APPLICATION_PROPERTIES: self.PROPERTIES % minimum}

    def missing(self, then, now):
        return release.missing_prerequisites(lambda ref, path: (then if ref == "v1.4.2" else now)[path],
                                             "v1.4.2")

    def test_both_changed_leaves_nothing_missing(self):
        self.assertEqual(self.missing(self.files("v1.0.0", "1.0.0"), self.files("v1.4.0", "1.4.0")), [])

    def test_neither_changed_leaves_both_missing(self):
        missing = self.missing(self.files("v1.0.0", "1.0.0"), self.files("v1.0.0", "1.0.0"))
        self.assertEqual(len(missing), 2)
        self.assertIn(release.OLDEST_SUPPORTED, missing[0])
        self.assertIn("taskfest.minimum-app-version", missing[1])

    def test_a_file_the_release_did_not_have_yet_counts_as_changed(self):
        then = {release.OLDEST_SUPPORTED: "", release.APPLICATION_PROPERTIES: ""}
        self.assertEqual(self.missing(then, self.files("v1.0.0", "1.0.0")), [])

    def test_only_the_values_count_not_the_comments_around_them(self):
        then = self.files("v1.0.0", "1.0.0")
        now = {path: "# reworded\n" + text for path, text in self.files("v1.0.0", "1.4.0").items()}
        self.assertEqual(len(self.missing(then, now)), 1)


class BeforeOneTest(unittest.TestCase):
    """Under 0.x `auto` gives a minor, and 1.0.0 is released by hand (#297)."""

    def test_auto_gives_a_minor_whatever_the_api_did(self):
        for changes in (REMOVED, ADDED, UNCHANGED):
            self.assertEqual(release.decide("auto", (0, 17, 0), changes).version, "0.18.0")

    def test_a_patch_may_be_asked_for(self):
        self.assertEqual(release.decide("patch", (0, 17, 0), ADDED).version, "0.17.1")

    def test_a_major_is_refused_because_1_0_0_is_released_by_hand(self):
        refused = release.decide("major", (0, 17, 0), UNCHANGED)
        self.assertIsNone(refused.version)
        self.assertIn("1.0.0", refused.summary)
        self.assertIn("doc/releasing.md", refused.summary)


class SummaryTest(unittest.TestCase):

    def test_it_states_the_version_the_step_and_oasdiffs_reasons(self):
        summary = release.decide("auto", (1, 4, 2), ADDED).summary
        self.assertIn("1.5.0", summary)
        self.assertIn("minor", summary)
        self.assertIn("v1.4.2", summary)
        self.assertIn("added the required property `minimumAppVersion`", summary)
        self.assertIn("GET /api/version", summary)

    def test_an_unchanged_api_says_so(self):
        self.assertIn("No change to the API", release.decide("auto", (1, 4, 2), UNCHANGED).summary)

    def test_a_major_points_to_the_steps_its_pull_request_needed(self):
        summary = release.decide("auto", (1, 4, 2), REMOVED).summary
        self.assertIn("doc/api/oldest-supported-release", summary)
        self.assertIn("taskfest.minimum-app-version", summary)

    def test_a_step_asked_for_under_0_x_is_not_called_the_rule(self):
        summary = release.decide("patch", (0, 17, 0), ADDED).summary
        self.assertIn("A **patch** was asked for", summary)
        self.assertNotIn("a release is a **patch**", summary)

    def test_under_0_x_it_still_reports_what_the_api_did(self):
        summary = release.decide("auto", (0, 17, 0), REMOVED).summary
        self.assertIn("removed the required property `minimumAppVersion`", summary)
        self.assertIn("0.x", summary)


class SameOasdiffTest(unittest.TestCase):
    """The release decides with the oasdiff Backend CI gates with (#297)."""

    def test_both_workflows_use_one_oasdiff_version(self):
        workflows = pathlib.Path(__file__).parents[1] / "workflows"
        versions = {
            name: set(re.findall(r"tufin/oasdiff:(\S+)", (workflows / name).read_text()))
            for name in ("backend-ci.yml", "cut-release.yml")
        }
        self.assertEqual(len(versions["backend-ci.yml"]), 1, versions)
        self.assertEqual(versions["cut-release.yml"], versions["backend-ci.yml"])


if __name__ == "__main__":
    unittest.main()
