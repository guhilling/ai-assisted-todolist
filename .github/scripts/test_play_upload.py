"""
Pins down how play-upload.py drives Google Play's publishing API, without Google.

The upload is the last step of a release's Android build and runs nowhere else, so a mistake in
the order of its calls, or in what it does when Play refuses, would first show on a release.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import contextlib
import importlib.util
import io
import pathlib
import tempfile
import unittest

_spec = importlib.util.spec_from_file_location(
    "play_upload", pathlib.Path(__file__).with_name("play-upload.py"))
play = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(play)

PACKAGE = "de.hilling.taskfest.qa"
EDITS = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PACKAGE}/edits"
UPLOAD = f"https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/{PACKAGE}/edits"


class FakePlay:
    """Answers the calls in order and records them; an answer that is an ApiError is raised."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.calls = []

    def request(self, method, url, body=None, content_type="application/json"):
        self.calls.append((method, url, body, content_type))
        answer = self.answers.pop(0)
        if isinstance(answer, play.ApiError):
            raise answer
        return answer


def internal_release(status):
    return {"track": "internal", "releases": [{"name": "1.4.0", "versionCodes": ["57"], "status": status}]}


class UploadTest(unittest.TestCase):

    def test_uploads_the_bundle_and_releases_it_to_internal_testers(self):
        api = FakePlay({"id": "e1"}, {"versionCode": 57}, {}, {})
        result = play.upload(api, PACKAGE, b"bundle", "1.4.0")
        self.assertEqual(api.calls, [
            ("POST", EDITS, None, "application/json"),
            ("POST", f"{UPLOAD}/e1/bundles?uploadType=media", b"bundle", "application/octet-stream"),
            ("PUT", f"{EDITS}/e1/tracks/internal", internal_release("completed"), "application/json"),
            ("POST", f"{EDITS}/e1:commit", None, "application/json"),
        ])
        self.assertEqual(result, play.Result(version_code=57, status="completed"))

    def test_an_app_play_has_never_had_a_build_of_needs_its_first_upload_by_hand(self):
        api = FakePlay(play.ApiError(404, "Package not found: de.hilling.taskfest.qa."))
        with self.assertRaisesRegex(play.FirstUploadByHand, "by hand"):
            play.upload(api, PACKAGE, b"bundle", "1.4.0")

    def test_any_other_refusal_is_reported_as_it_is(self):
        api = FakePlay({"id": "e1"}, play.ApiError(403, "The caller does not have permission"))
        with self.assertRaisesRegex(play.ApiError, "permission"):
            play.upload(api, PACKAGE, b"bundle", "1.4.0")

    def test_an_app_still_in_draft_gets_a_draft_release_in_a_new_edit(self):
        # A refused commit may have ended its edit, so the draft starts over rather than reuse it.
        draft_only = play.ApiError(400, "Only releases with status draft may be created on draft app.")
        api = FakePlay({"id": "e1"}, {"versionCode": 57}, {}, draft_only,
                       {"id": "e2"}, {"versionCode": 57}, {}, {})
        result = play.upload(api, PACKAGE, b"bundle", "1.4.0")
        self.assertEqual(api.calls[4:], [
            ("POST", EDITS, None, "application/json"),
            ("POST", f"{UPLOAD}/e2/bundles?uploadType=media", b"bundle", "application/octet-stream"),
            ("PUT", f"{EDITS}/e2/tracks/internal", internal_release("draft"), "application/json"),
            ("POST", f"{EDITS}/e2:commit", None, "application/json"),
        ])
        self.assertEqual(result, play.Result(version_code=57, status="draft"))

    def test_the_draft_refusal_may_come_with_the_track_as_well(self):
        draft_only = play.ApiError(400, "Only releases with status draft may be created on draft app.")
        api = FakePlay({"id": "e1"}, {"versionCode": 57}, draft_only, {"id": "e2"}, {"versionCode": 57}, {}, {})
        result = play.upload(api, PACKAGE, b"bundle", "1.4.0")
        self.assertEqual(api.calls[5][2], internal_release("draft"))
        self.assertEqual(result.status, "draft")

    def test_the_draft_wording_in_any_other_refusal_is_reported_as_it_is(self):
        api = FakePlay({"id": "e1"}, {"versionCode": 57}, {},
                       play.ApiError(500, "Internal error while committing to draft app."))
        with self.assertRaisesRegex(play.ApiError, "Internal error"):
            play.upload(api, PACKAGE, b"bundle", "1.4.0")
        self.assertEqual(len(api.calls), 4)


class MainTest(unittest.TestCase):
    """The first upload is a person's step, expected once per app: a warning, not a failed release."""

    def test_an_app_without_a_build_is_a_warning_and_the_run_succeeds(self):
        with tempfile.NamedTemporaryFile() as bundle:
            api = FakePlay(play.ApiError(404, "Package not found: de.hilling.taskfest.qa."))
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                status = play.run(api, PACKAGE, pathlib.Path(bundle.name), "1.4.0")
        self.assertEqual(status, 0)
        self.assertIn("::warning::", out.getvalue())
        self.assertIn("by hand", out.getvalue())

    def test_any_other_refusal_fails_the_run(self):
        with tempfile.NamedTemporaryFile() as bundle:
            api = FakePlay(play.ApiError(403, "The caller does not have permission"))
            with contextlib.redirect_stdout(io.StringIO()):
                status = play.run(api, PACKAGE, pathlib.Path(bundle.name), "1.4.0")
        self.assertEqual(status, 1)


class SummaryTest(unittest.TestCase):

    def test_a_completed_release_says_testers_have_it(self):
        text = play.summary(PACKAGE, "1.4.0", play.Result(version_code=57, status="completed"))
        self.assertIn("internal testers", text)
        self.assertIn("57", text)

    def test_a_draft_says_it_waits_for_a_rollout_by_hand(self):
        text = play.summary(PACKAGE, "1.4.0", play.Result(version_code=57, status="draft"))
        self.assertIn("Play Console", text)
        self.assertIn("draft", text)


if __name__ == "__main__":
    unittest.main()
