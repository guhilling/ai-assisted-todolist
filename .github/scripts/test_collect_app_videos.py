"""
Pins down how collect-live-videos.py turns the app's live run (#278) into published videos: the
recordings run-on-qa.sh made, one per Maestro flow, named and indexed the way the website's are.

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


def _flows(root):
    """What run-on-qa.sh writes beside its recordings: each flow, in the order it ran."""
    return [
        {"flow": "mobile/maestro/live/change-tasks.yaml", "title": "Change the board on qa", "status": "passed",
         "durationMs": 61000, "recording": str(root / "change-tasks.mp4")},
        {"flow": "mobile/maestro/live/attach.yaml", "title": "Attach an image on qa", "status": "failed",
         "durationMs": 45000, "recording": str(root / "attach.mp4")},
        # A flow whose recording never started has nothing to show.
        {"flow": "mobile/maestro/live/never.yaml", "title": "Not recorded", "status": "failed",
         "durationMs": 0, "recording": str(root / "never.mp4")},
    ]


class AppVideosTest(unittest.TestCase):

    def test_every_flow_that_recorded_one_in_the_order_it_ran(self):
        with tempfile.TemporaryDirectory() as raw:
            root = pathlib.Path(raw)
            (root / "change-tasks.mp4").write_bytes(b"one")
            (root / "attach.mp4").write_bytes(b"two")

            videos = collect.app_videos_in(_flows(root))

            self.assertEqual([(video.spec, video.title, video.status) for video in videos], [
                ("mobile/maestro/live/change-tasks.yaml", "Change the board on qa", "passed"),
                ("mobile/maestro/live/attach.yaml", "Attach an image on qa", "failed"),
            ])
            self.assertEqual(videos[0].duration_ms, 61000)

    def test_a_name_from_the_flow_alone_that_stays_the_same_from_run_to_run(self):
        self.assertEqual(collect.app_name("mobile/maestro/live/change-tasks.yaml"), "app-change-tasks.mp4")


class CollectAppTest(unittest.TestCase):

    def test_copies_the_recordings_and_writes_an_index_shaped_like_the_websites(self):
        with tempfile.TemporaryDirectory() as raw:
            root = pathlib.Path(raw)
            (root / "change-tasks.mp4").write_bytes(b"one")
            (root / "attach.mp4").write_bytes(b"two")
            flows = root / "flows.json"
            flows.write_text(json.dumps(_flows(root)))
            out = root / "out"

            def poster(video, image):
                image.write_bytes(b"jpeg of " + video.read_bytes())
                return True

            collect.collect_app(flows, out, environment="qa", version="1.1.4",
                                run_url="https://github.com/x/actions/runs/2", recorded_at="2026-10-18T09:00:00Z",
                                make_poster=poster)

            self.assertEqual((out / "app-change-tasks.mp4").read_bytes(), b"one")
            index = json.loads((out / "index.json").read_text())
            self.assertEqual((index["environment"], index["version"], index["runUrl"]),
                             ("qa", "1.1.4", "https://github.com/x/actions/runs/2"))
            self.assertEqual([video["file"] for video in index["videos"]], ["app-change-tasks.mp4", "app-attach.mp4"])
            self.assertEqual(index["videos"][1]["status"], "failed")
            self.assertEqual(index["videos"][0]["poster"], "app-change-tasks.jpg")
            self.assertEqual((out / "app-change-tasks.jpg").read_bytes(), b"jpeg of one")


if __name__ == "__main__":
    unittest.main()
