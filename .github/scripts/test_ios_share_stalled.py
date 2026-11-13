"""
Pins down mobile/maestro/ios/share-stalled.sh, which tells the simulator's Photos stalling before
TaskFest's extension started from a share that failed on TaskFest (#533). Mobile CI runs the iOS
photo share once more after the first kind only: Photos still "Preparing..." after the flow's own
restart and second share, which share-photo.yaml fails on by name. Every other failure -- TaskFest
Dev missing from the sheet, the extension never opening the app, in either flow -- still fails at
once.

Each test hands the script Maestro's console output, as it writes it.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import pathlib
import subprocess
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "mobile" / "maestro" / "ios" / "share-stalled.sh"

PHOTOS_STUCK = """\
[Passed] launchApp
[Failed] Share a photo into the app through iOS's share sheet (3m 41s) (Assertion is false: "Preparing.*" is not visible)
1/1 Flow Failed
"""
# The same wait failing without Photos' "Preparing" on the screen: TaskFest's extension did not open
# the app, in the photo flow or in Safari's.
EXTENSION_NEVER_OPENED_THE_APP = """\
[Failed] Share a photo into the app through iOS's share sheet (3m 41s) (Assertion is false: "(Open in .TaskFest Dev.\\?|Sign in with Keycloak)" is visible)
1/1 Flow Failed
"""
SAFARI_EXTENSION_STALLED = """\
[Failed] Share a link from Safari into the app through iOS's share sheet (4m 2s) (Assertion is false: "(Open in .TaskFest Dev.\\?|Sign in with Keycloak)" is visible)
1/1 Flow Failed
"""
# An optional step's earlier failure mentioning Preparing, then a failure of TaskFest's.
EARLIER_PREPARING_THEN_APP = """\
[Warning] extendedWaitUntil optional: "Preparing.*" was still visible
[Failed] Share a photo into the app through iOS's share sheet (7m 52s) (Assertion is false: "Sign in with Keycloak" is visible)
1/1 Flow Failed
"""
NOT_OFFERED = """\
[Failed] Share a photo into the app through iOS's share sheet (1m 2s) (Element not found: Text matching regex: TaskFest Dev)
1/1 Flow Failed
"""
PASSED = """\
[Passed] Share a photo into the app through iOS's share sheet (48s)
1/1 Flow Passed
"""


def stalled(console: str) -> bool:
    with tempfile.TemporaryDirectory() as directory:
        file = pathlib.Path(directory) / "console.txt"
        file.write_text(console)
        return subprocess.run(["bash", str(SCRIPT), str(file)]).returncode == 0


class ShareStalled(unittest.TestCase):
    def test_photos_still_preparing_is_the_simulators(self):
        self.assertTrue(stalled(PHOTOS_STUCK))

    def test_the_extension_never_opening_the_app_fails_at_once(self):
        self.assertFalse(stalled(EXTENSION_NEVER_OPENED_THE_APP))

    def test_the_safari_flows_extension_stalling_fails_at_once(self):
        self.assertFalse(stalled(SAFARI_EXTENSION_STALLED))

    def test_only_the_final_failure_counts(self):
        self.assertFalse(stalled(EARLIER_PREPARING_THEN_APP))

    def test_taskfest_dev_missing_from_the_sheet_fails_at_once(self):
        self.assertFalse(stalled(NOT_OFFERED))

    def test_a_flow_that_passed_is_no_stall(self):
        self.assertFalse(stalled(PASSED))

    def test_a_missing_console_is_no_stall(self):
        self.assertNotEqual(subprocess.run(["bash", str(SCRIPT), "/nonexistent/console.txt"],
                                           capture_output=True).returncode, 0)


if __name__ == "__main__":
    unittest.main()
