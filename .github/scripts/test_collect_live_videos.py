"""
Pins down how collect-live-videos.py turns a Playwright JSON report into the published videos:
which scenarios have one, under which stable name, and what the index says.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import importlib.util
import json
import pathlib
import tempfile
import unittest

_spec = importlib.util.spec_from_file_location(
    "collect_live_videos", pathlib.Path(__file__).with_name("collect-live-videos.py"))
collect = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(collect)


def _test(status, video=None, duration=1200):
    attachments = [{"name": "video", "contentType": "video/webm", "path": video}] if video else []
    return {"results": [{"status": status, "duration": duration, "attachments": attachments}]}


def _report(videos_dir):
    return {"suites": [
        {"file": "login.spec.ts", "specs": [
            {"title": "signs an account in and manages its tasks",
             "tests": [_test("passed", str(videos_dir / "a.webm"), 6500)]},
        ], "suites": [
            {"file": "login.spec.ts", "title": "nested", "specs": [
                {"title": "deletes a task for good", "tests": [_test("failed", str(videos_dir / "b.webm"))]},
            ]},
        ]},
        {"file": "thumbnails.spec.ts", "specs": [
            {"title": "shows a photo on its row by a thumbnail the browser made",
             "tests": [_test("skipped")]},
        ]},
    ]}


class VideosInTest(unittest.TestCase):

    def test_every_scenario_that_recorded_one_in_report_order(self):
        videos = collect.videos_in(_report(pathlib.Path("/v")))

        self.assertEqual([(video.spec, video.title, video.status) for video in videos], [
            ("login.spec.ts", "signs an account in and manages its tasks", "passed"),
            ("login.spec.ts", "deletes a task for good", "failed"),
        ])
        self.assertEqual(videos[0].duration_ms, 6500)

    def test_a_name_that_stays_the_same_from_run_to_run(self):
        self.assertEqual(collect.stable_name("login.spec.ts", "Signs an account in, and manages its tasks!"),
                         "login-signs-an-account-in-and-manages-its-tasks.webm")


class CollectTest(unittest.TestCase):

    def test_copies_the_videos_and_writes_an_index(self):
        with tempfile.TemporaryDirectory() as raw:
            root = pathlib.Path(raw)
            (root / "a.webm").write_bytes(b"one")
            (root / "b.webm").write_bytes(b"two")
            report = root / "report.json"
            report.write_text(json.dumps(_report(root)))
            out = root / "out"

            collect.collect(report, out, environment="qa", version="0.12.0",
                            run_url="https://github.com/x/actions/runs/1", recorded_at="2026-10-09T08:00:00Z")

            self.assertEqual((out / "login-signs-an-account-in-and-manages-its-tasks.webm").read_bytes(), b"one")
            index = json.loads((out / "index.json").read_text())
            self.assertEqual(index["environment"], "qa")
            self.assertEqual(index["version"], "0.12.0")
            self.assertEqual(index["runUrl"], "https://github.com/x/actions/runs/1")
            self.assertEqual([video["file"] for video in index["videos"]], [
                "login-signs-an-account-in-and-manages-its-tasks.webm", "login-deletes-a-task-for-good.webm"])
            self.assertEqual(index["videos"][1]["status"], "failed")



class SeveralVideosTest(unittest.TestCase):
    """A scenario that opens a second tab -- opening a PDF does -- has a video per tab."""

    def test_the_largest_is_the_scenario(self):
        with tempfile.TemporaryDirectory() as raw:
            root = pathlib.Path(raw)
            (root / "tab.webm").write_bytes(b"x")
            (root / "page.webm").write_bytes(b"x" * 100)
            report = {"suites": [{"file": "attachments.spec.ts", "specs": [{"title": "opens a PDF", "tests": [
                {"results": [{"status": "passed", "duration": 9000, "attachments": [
                    {"name": "video", "path": str(root / "tab.webm")},
                    {"name": "video", "path": str(root / "page.webm")},
                ]}]}]}]}]}

            self.assertEqual(collect.videos_in(report)[0].path, str(root / "page.webm"))


class PosterTest(unittest.TestCase):

    def test_each_video_gets_the_poster_made_for_it(self):
        with tempfile.TemporaryDirectory() as raw:
            root = pathlib.Path(raw)
            (root / "a.webm").write_bytes(b"one")
            (root / "b.webm").write_bytes(b"two")
            report = root / "report.json"
            report.write_text(json.dumps(_report(root)))
            out = root / "out"

            def poster(video, image):
                image.write_bytes(b"jpeg of " + video.read_bytes())
                return True

            collect.collect(report, out, environment="qa", version="0.12.0", run_url="u",
                            recorded_at="t", make_poster=poster)

            index = json.loads((out / "index.json").read_text())
            self.assertEqual(index["videos"][0]["poster"], "login-signs-an-account-in-and-manages-its-tasks.jpg")
            self.assertEqual((out / index["videos"][0]["poster"]).read_bytes(), b"jpeg of one")

    def test_a_video_without_a_poster_says_so(self):
        with tempfile.TemporaryDirectory() as raw:
            root = pathlib.Path(raw)
            (root / "a.webm").write_bytes(b"one")
            (root / "b.webm").write_bytes(b"two")
            report = root / "report.json"
            report.write_text(json.dumps(_report(root)))

            collect.collect(report, root / "out", environment="qa", version="0.12.0", run_url="u",
                            recorded_at="t", make_poster=lambda video, image: False)

            index = json.loads((root / "out" / "index.json").read_text())
            self.assertNotIn("poster", index["videos"][0])

    def test_candidates_are_spread_across_the_video_clear_of_both_ends(self):
        # A scenario starts and ends on the sign-in page; the middle is where it does something.
        self.assertEqual(collect.poster_times(10.0), [2.0, 4.0, 6.0, 8.0])

    def test_the_busiest_frame_is_the_poster(self):
        with tempfile.TemporaryDirectory() as raw:
            root = pathlib.Path(raw)
            (root / "plain.jpg").write_bytes(b"x")
            (root / "board.jpg").write_bytes(b"x" * 50)

            self.assertEqual(collect.busiest([root / "plain.jpg", root / "board.jpg", root / "missing.jpg"]),
                             root / "board.jpg")
            self.assertIsNone(collect.busiest([root / "missing.jpg"]))


if __name__ == "__main__":
    unittest.main()
