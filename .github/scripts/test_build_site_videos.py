"""
Pins down the site's page of the newest live run (#278): the website's videos and the app's, each
in a section of its own, and a line in place of either whose recording is gone.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import importlib.util
import json
import pathlib
import tempfile
import unittest

_spec = importlib.util.spec_from_file_location("build_site", pathlib.Path(__file__).with_name("build-site.py"))
site = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(site)


def _run(root, name, files):
    source = root / name
    source.mkdir()
    for file in files:
        (source / file).write_bytes(b"video")
    (source / "index.json").write_text(json.dumps({
        "environment": "qa", "version": "1.1.4", "recordedAt": "2026-10-18T09:00:00Z",
        "runUrl": "https://github.com/x/actions/runs/3",
        "videos": [{"spec": "spec", "title": f"title of {file}", "status": "passed", "file": file} for file in files],
    }))
    return source


class VideosPageTest(unittest.TestCase):

    def test_shows_the_websites_and_the_apps_videos_in_sections_of_their_own(self):
        with tempfile.TemporaryDirectory() as raw:
            root = pathlib.Path(raw)
            web = _run(root, "web", ["login-signs-in.webm"])
            app = _run(root, "app", ["app-change-tasks.mp4"])

            site.build_videos(root / "site", web, app)

            page = (root / "site" / "videos" / "index.html").read_text()
            self.assertLess(page.index('id="website"'), page.index("login-signs-in.webm"))
            self.assertLess(page.index('id="app"'), page.index("app-change-tasks.mp4"))
            self.assertTrue((root / "site" / "videos" / "app-change-tasks.mp4").exists())

    def test_says_so_where_a_recording_is_gone(self):
        with tempfile.TemporaryDirectory() as raw:
            root = pathlib.Path(raw)
            web = _run(root, "web", ["login-signs-in.webm"])

            site.build_videos(root / "site", web, None)

            page = (root / "site" / "videos" / "index.html").read_text()
            self.assertIn("login-signs-in.webm", page)
            self.assertIn("No recording of the app's flows is available", page)


if __name__ == "__main__":
    unittest.main()
